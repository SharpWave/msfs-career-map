# EXE.xml fixtures

Kept with LF line endings and `{{PROGRAM}}` where the app's path goes; `support/sims.ts` loads them with
the test's program put in (XML-escaped) and in the line endings, byte-order mark and encoding a test asks
for. Variants (CR LF, a BOM, UTF-16) come from the loader, not from extra files. A blank or empty file is
built in the test itself.

| File | What |
|---|---|
| `real-six.xml` | UTF-8, six other add-ons as MSFS, FSUIPC and installers write them, a comment, escaped `&` and `<` |
| `real-six-1252.xml` | windows-1252 declared, an `é` in another add-on's name and path |
| `minified.xml` | everything on one line |
| `self-closing.xml` | a self-closing root |
| `malformed.xml` | a mismatched end tag |
| `wrong-root.xml` | `Type="AceXML"`, holding the app's entry |
| `with-app.xml` | the app's entry already there, tab-indented, elements reordered, `false` lower case, values padded |
| `twice.xml` | the app's entry twice, the second turned off, another add-on between |
| `off-disabled.xml` / `off-manualload.xml` | the app's entry turned off by `Disabled` / `ManualLoad` |
| `altered-missing.xml` / `altered-added.xml` / `altered-changed.xml` | an element missing, added, changed |
| `other-name.xml` | the program under another name, and the name with another program: neither the app's |
| `after-app.xml` | entries and a comment after the app's |
| `name-case.xml` | the name in other case with surrounding whitespace |
| `inline-app.xml` | the app's entry sharing a line with another add-on's |
