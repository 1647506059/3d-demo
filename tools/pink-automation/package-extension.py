"""Package the local extension without downloading a build tool."""
from pathlib import Path
import json
import zipfile

root = Path(__file__).resolve().parent
manifest = json.loads((root / 'extension/package.json').read_text(encoding='utf-8'))
output = root / f"pink-automation-bridge-{manifest['version']}.vsix"
vsix = f'''<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011">
<Metadata><Identity Language="en-US" Id="pink-automation-bridge" Version="{manifest['version']}" Publisher="SUD"/><DisplayName>PinK External Automation Bridge (Local)</DisplayName><Description xml:space="preserve">Local project-bound Pink automation outside Chat.</Description><Tags>pink,automation</Tags><Categories>Other</Categories><Properties><Property Id="Microsoft.VisualStudio.Code.Engine" Value="^1.127.0"/><Property Id="Microsoft.VisualStudio.Code.ExtensionDependencies" Value=""/><Property Id="Microsoft.VisualStudio.Code.ExtensionPack" Value=""/><Property Id="Microsoft.VisualStudio.Code.LocalizedLanguages" Value=""/></Properties></Metadata>
<Installation><InstallationTarget Id="Microsoft.VisualStudio.Code"/></Installation><Dependencies/>
<Assets><Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true"/></Assets></PackageManifest>'''
content_types = '''<?xml version="1.0" encoding="utf-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="json" ContentType="application/json"/><Default Extension="cjs" ContentType="application/javascript"/><Default Extension="vsixmanifest" ContentType="text/xml"/></Types>'''
with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
    archive.writestr('extension.vsixmanifest', vsix)
    archive.writestr('[Content_Types].xml', content_types)
    for file in sorted((root / 'extension').iterdir()):
        if file.is_file():
            archive.write(file, f'extension/{file.name}')
print(output)
