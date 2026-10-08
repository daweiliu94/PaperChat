"""Add redistribution notices and matching font sources to an app-only ZIP."""
from pathlib import Path
import sys
import zipfile

root = Path(__file__).resolve().parent.parent
extras = [
    root / "THIRD_PARTY_NOTICES.txt",
    root / "third_party/liberation-fonts-1.07.4.tar.gz",
]
payloads = [(path.name, path.read_bytes()) for path in extras]
with zipfile.ZipFile(sys.argv[1], "a", compression=zipfile.ZIP_DEFLATED) as archive:
    names = archive.namelist()
    if not names or any(not name.startswith("PaperChat.app/") for name in names):
        raise SystemExit("Expected an app-only PaperChat ZIP; refuse duplicate or unrelated entries.")
    for name, data in payloads:
        archive.writestr(name, data)
