# PDF fonts

`NotoSansSC-Regular.ttf` and `NotoSansSC-Bold.ttf` are static TrueType
instances generated from the OFL-licensed Google Fonts source:

- Source: `https://github.com/google/fonts/blob/main/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf`
- Source SHA-256: `A3041811A78C361B1DE50F953C805E0244951C21C5BD412F7232EF0D899AF0DA`
- License: `OFL.txt`

They were instantiated with fontTools 4.63.0:

```powershell
python -m fontTools.varLib.instancer NotoSansSC-wght.ttf wght=400 --update-name-table --output NotoSansSC-Regular.ttf
python -m fontTools.varLib.instancer NotoSansSC-wght.ttf wght=700 --update-name-table --output NotoSansSC-Bold.ttf
```

Generated SHA-256 values:

- Regular: `C4E570E5DBF33E7335521C5C458381D7CD64A81C47BCB741BAC1F618FDCCE8B7`
- Bold: `F01AF34EA2297B3B7AD66791BC13F9646B3A92DB431200C30232B2208F70ACE3`

The TrueType `glyf` outlines are intentional. At export time,
`fonteditor-core` builds a document-specific Regular/Bold TTF from the exact
characters in the plan. `pdf-lib` embeds those finished fonts with
`subset: false`, producing `CIDFontType2` resources with `Identity-H` encoding
and `ToUnicode` maps. This avoids the malformed `glyf` records produced when
fontkit subsets these source fonts directly. Do not replace this pipeline with
CFF fonts or direct fontkit subsetting without repeating the rendered-glyph and
Android compatibility checks.
