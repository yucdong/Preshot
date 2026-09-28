use std::{collections::HashMap, sync::OnceLock};

use jieba_rs::Jieba;
use rusqlite::{params, Connection};

use super::{error, models::*, validation, Result};

pub const GENERATION: &str = "jieba-0.8.1-default-search-nfkc-description-v3";

fn jieba() -> &'static Jieba {
    static INSTANCE: OnceLock<Jieba> = OnceLock::new();
    INSTANCE.get_or_init(Jieba::new)
}

fn tokens(value: &str) -> Vec<String> {
    jieba()
        .cut_for_search(value, true)
        .into_iter()
        .filter(|token| token.chars().any(char::is_alphanumeric))
        .map(str::to_owned)
        .collect()
}

pub fn projection(conn: &Connection, rowid: i64, detail: &MaterialDetail) -> Result<()> {
    let name = validation::normalized(&detail.summary.metadata.name);
    let tags = validation::normalized(&detail.summary.metadata.tags.join("\n"));
    let body = validation::normalized(&format!(
        "{}\n{}",
        detail.summary.metadata.description,
        validation::body(&detail.payload)
    ));
    conn.execute("INSERT INTO material_search(rowid,name_raw,tags_raw,body_raw,name_tokens,tags_tokens,body_tokens)
        VALUES(?1,?2,?3,?4,?5,?6,?7) ON CONFLICT(rowid) DO UPDATE SET
        name_raw=excluded.name_raw,tags_raw=excluded.tags_raw,body_raw=excluded.body_raw,
        name_tokens=excluded.name_tokens,tags_tokens=excluded.tags_tokens,body_tokens=excluded.body_tokens",
        params![rowid, name, tags, body, tokens(&name).join(" "), tokens(&tags).join(" "), tokens(&body).join(" ")])
        .map_err(|e| error("index", e))?;
    Ok(())
}

pub fn rebuild_if_needed(conn: &mut Connection) -> Result<()> {
    use rusqlite::OptionalExtension;
    let generation: Option<String> = conn
        .query_row(
            "SELECT value FROM library_meta WHERE key='index_generation'",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| error("index", e))?;
    if generation.as_deref() == Some(GENERATION) {
        return Ok(());
    }
    let tx = conn.transaction().map_err(|e| error("index", e))?;
    let rows = {
        let mut statement = tx
            .prepare("SELECT rowid,detail_json FROM materials")
            .map_err(|e| error("index", e))?;
        let rows = statement
            .query_map([], |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|e| error("index", e))?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|e| error("index", e))?;
        rows
    };
    tx.execute("DELETE FROM material_search", [])
        .map_err(|e| error("index", e))?;
    for (rowid, json) in rows {
        let detail = serde_json::from_str(&json).map_err(|e| error("corrupt", e))?;
        projection(&tx, rowid, &detail)?;
    }
    tx.execute(
        "INSERT INTO material_fts(material_fts) VALUES('rebuild')",
        [],
    )
    .map_err(|e| error("index", e))?;
    tx.execute(
        "INSERT INTO library_meta(key,value) VALUES('index_generation',?1)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        [GENERATION],
    )
    .map_err(|e| error("index", e))?;
    tx.commit().map_err(|e| error("index", e))
}

pub fn search(conn: &Connection, input: MaterialSearch) -> Result<MaterialSearchResult> {
    if input.limit == 0 || input.limit > 100 || input.query.chars().count() > 256 {
        return Err(error(
            "search",
            "Search requires a 1–100 item page and at most 256 query characters",
        ));
    }
    let query = validation::normalized(input.query.trim());
    let exact_name = input
        .exact_name
        .as_deref()
        .map(validation::material_name)
        .transpose()?;
    let chunks: Vec<_> = query.split_whitespace().collect();
    if chunks.len() > 32 {
        return Err(error("search", "Search has too many whitespace chunks"));
    }
    let mut lexical = Vec::new();
    for chunk in &chunks {
        let expression = tokens(chunk)
            .iter()
            .map(|token| format!("\"{}\"", token.replace('"', "\"\"")))
            .collect::<Vec<_>>()
            .join(" AND ");
        let mut matches = HashMap::new();
        // Punctuation-only chunks have no lexical branch, never a wildcard.
        if !expression.is_empty() {
            let mut statement = conn
                .prepare(
                    "SELECT rowid,bm25(material_fts,8.0,5.0,1.0)
                FROM material_fts WHERE material_fts MATCH ?1",
                )
                .map_err(|e| error("search", e))?;
            let rows = statement
                .query_map([expression], |row| {
                    Ok((row.get::<_, i64>(0)?, row.get::<_, f64>(1)?))
                })
                .map_err(|e| error("search", e))?;
            for row in rows {
                let (id, score) = row.map_err(|e| error("search", e))?;
                matches.insert(id, score);
            }
        }
        lexical.push(matches);
    }
    let mut statement = conn
        .prepare(
            "SELECT m.rowid,m.detail_json,s.name_raw,s.tags_raw,s.body_raw
        FROM materials m JOIN material_search s ON s.rowid=m.rowid
        WHERE (?1 IS NULL OR m.kind=?1 OR (?1='propClothing' AND m.kind IN ('prop','clothing')))
        AND (?2=0 OR json_extract(m.detail_json,'$.favorite')=1)
        AND ((?3=1 AND json_extract(m.detail_json,'$.deletedAt') IS NOT NULL)
          OR (?3=0 AND json_extract(m.detail_json,'$.deletedAt') IS NULL))
        AND (?4 IS NULL OR json_extract(m.detail_json,'$.name')=?4)
        AND (?5=0 OR m.kind IN ('image','imageGroup'))",
        )
        .map_err(|e| error("search", e))?;
    let rows = statement
        .query_map(
            params![
                input.kind.map(|kind| kind.as_str()),
                input.favorites.unwrap_or(false),
                input.trash.unwrap_or(false),
                exact_name,
                input.images_only.unwrap_or(false)
            ],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                ))
            },
        )
        .map_err(|e| error("search", e))?;
    let mut matches = Vec::new();
    for row in rows {
        let (rowid, json, name, tags, body) = row.map_err(|e| error("search", e))?;
        if chunks.iter().enumerate().all(|(i, chunk)| {
            name.contains(chunk)
                || tags.contains(chunk)
                || body.contains(chunk)
                || lexical[i].contains_key(&rowid)
        }) {
            let detail: MaterialDetail =
                serde_json::from_str(&json).map_err(|e| error("corrupt", e))?;
            let tier = if query.is_empty() || name == query {
                0
            } else if name.starts_with(&query) {
                1
            } else if name.contains(&query) {
                2
            } else if tags.contains(&query) {
                3
            } else {
                4
            };
            let score: f64 = lexical.iter().filter_map(|chunk| chunk.get(&rowid)).sum();
            matches.push((detail.summary, name, tier, score));
        }
    }
    matches.sort_by(|a, b| {
        let recent = || {
            b.0.updated_at
                .cmp(&a.0.updated_at)
                .then_with(|| a.0.id.cmp(&b.0.id))
        };
        match input.sort {
            SearchSort::Name => a.1.cmp(&b.1).then_with(|| a.0.id.cmp(&b.0.id)),
            SearchSort::Recent => recent(),
            SearchSort::Relevance if query.is_empty() => recent(),
            SearchSort::Relevance => {
                a.2.cmp(&b.2)
                    .then_with(|| a.3.total_cmp(&b.3))
                    .then_with(recent)
            }
        }
    });
    let total = matches.len();
    let items = matches
        .into_iter()
        .skip(input.offset as usize)
        .take(input.limit as usize)
        .map(|m| m.0)
        .collect();
    Ok(MaterialSearchResult {
        items,
        total,
        index_state: "ready",
    })
}
