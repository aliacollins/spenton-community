"""Generate a small, dependency-free Xcode project from the checked-in sources."""
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1] / 'SpentOn'
subprocess.run([sys.executable, str(root.parent / 'tools/generate-pip-vector.py')], check=True)
subprocess.run([sys.executable, str(root.parent / 'tools/generate-feedback-sounds.py')], check=True)
version = json.loads((root.parents[1] / 'package.json').read_text())['version'].split('-')[0]
project = root / 'SpentOn.xcodeproj'
project.mkdir(exist_ok=True)
def uid(name): return hashlib.sha256(name.encode()).hexdigest()[:24].upper()
def quote(text): return json.dumps(str(text))
objects = {}
def add(name, value):
    objects[uid(name)] = value
    return uid(name)
source_files = sorted((root / 'Sources').rglob('*.swift'))
# Share the checked-in recordings with the web app instead of duplicating binaries.
voice = [p for p in sorted((root.parents[1] / 'public/audio/pip').glob('*.mp3')) if p.name != 'pip-garden.mp3']
if not voice:
    raise SystemExit('The existing Pip voice recordings are missing from public/audio/pip.')
resources = [root / 'Sources/Core/Resources/engine.js', root / 'Assets.xcassets', root / 'PrivacyInfo.xcprivacy',
             root.parents[1] / 'LICENSE', root.parents[1] / 'LICENSE_SCOPE.md',
             root.parents[1] / 'public/third-party-notices.txt', *sorted((root / 'Resources').glob('*.wav')), *voice]
refs, source_build, resource_build = [], [], []
signing = add('signing-config', '{isa = PBXFileReference; lastKnownFileType = text.xcconfig; path = Signing.xcconfig; sourceTree = "<group>"; }')
refs.append(signing)
for path in source_files + resources:
    relative = Path(os.path.relpath(path, root)).as_posix()
    kind = 'sourcecode.swift' if path.suffix == '.swift' else 'folder.assetcatalog' if path.suffix == '.xcassets' else 'text.xml' if path.suffix == '.xcprivacy' else 'audio.wav' if path.suffix == '.wav' else 'audio.mp3' if path.suffix == '.mp3' else 'sourcecode.javascript'
    ref = add('ref:' + relative, f'{{isa = PBXFileReference; lastKnownFileType = {kind}; path = {quote(relative)}; sourceTree = "<group>"; }}')
    refs.append(ref)
    build = add('build:' + relative, f'{{isa = PBXBuildFile; fileRef = {ref}; }}')
    (source_build if path.suffix == '.swift' else resource_build).append(build)
app = add('app', '{isa = PBXFileReference; explicitFileType = wrapper.application; path = SpentOn.app; sourceTree = BUILT_PRODUCTS_DIR; }')
products = add('products', f'{{isa = PBXGroup; children = ({app}); name = Products; sourceTree = "<group>"; }}')
group = add('group', f'{{isa = PBXGroup; children = ({",".join(refs + [products])}); sourceTree = "<group>"; }}')
sources = add('sources', f'{{isa = PBXSourcesBuildPhase; buildActionMask = 2147483647; files = ({",".join(source_build)}); runOnlyForDeploymentPostprocessing = 0; }}')
resource_phase = add('resources', f'{{isa = PBXResourcesBuildPhase; buildActionMask = 2147483647; files = ({",".join(resource_build)}); runOnlyForDeploymentPostprocessing = 0; }}')
frameworks = add('frameworks', '{isa = PBXFrameworksBuildPhase; buildActionMask = 2147483647; files = (); runOnlyForDeploymentPostprocessing = 0; }')
configs = {}
for target in ['project', 'target']:
    ids = []
    for mode in ['Debug', 'Release']:
        settings = {
            'SDKROOT': 'iphoneos', 'IPHONEOS_DEPLOYMENT_TARGET': '26.0', 'SWIFT_VERSION': '6.0',
            'CLANG_ENABLE_MODULES': 'YES', 'SWIFT_OPTIMIZATION_LEVEL': '-Onone' if mode == 'Debug' else '-O',
            'SWIFT_ACTIVE_COMPILATION_CONDITIONS': 'DEBUG' if mode == 'Debug' else '',
            'DEBUG_INFORMATION_FORMAT': 'dwarf' if mode == 'Debug' else 'dwarf-with-dsym',
        } if target == 'project' else {
            'PRODUCT_BUNDLE_IDENTIFIER': 'dev.spenton.ios', 'PRODUCT_NAME': 'SpentOn',
            'INFOPLIST_FILE': 'SpentOn-Info.plist', 'GENERATE_INFOPLIST_FILE': 'YES', 'INFOPLIST_KEY_CFBundleDisplayName': 'SpentOn',
            'INFOPLIST_KEY_UILaunchScreen_Generation': 'YES', 'INFOPLIST_KEY_UIApplicationSceneManifest_Generation': 'YES',
            'INFOPLIST_KEY_UISupportedInterfaceOrientations': 'UIInterfaceOrientationPortrait UIInterfaceOrientationLandscapeLeft UIInterfaceOrientationLandscapeRight',
            'INFOPLIST_KEY_ITSAppUsesNonExemptEncryption': 'NO',
            'TARGETED_DEVICE_FAMILY': '1,2', 'CODE_SIGN_STYLE': 'Automatic',
            'CODE_SIGN_ENTITLEMENTS': 'SpentOn.entitlements',
            'ASSETCATALOG_COMPILER_APPICON_NAME': 'AppIcon',
            'MARKETING_VERSION': version, 'CURRENT_PROJECT_VERSION': '1',
            'SKIP_INSTALL': 'NO',
            'SWIFT_EMIT_LOC_STRINGS': 'YES', 'ENABLE_USER_SCRIPT_SANDBOXING': 'YES',
            'INFOPLIST_KEY_NSAppTransportSecurity_NSAllowsLocalNetworking': 'YES' if mode == 'Debug' else 'NO',
        }
        setting_text = ' '.join(f'{k} = {quote(v)};' for k, v in settings.items())
        base_config = f'baseConfigurationReference = {signing}; ' if target == 'target' else ''
        ids.append(add(target + mode, f'{{isa = XCBuildConfiguration; {base_config}buildSettings = {{{setting_text}}}; name = {mode}; }}'))
    configs[target] = add(target + 'configs', f'{{isa = XCConfigurationList; buildConfigurations = ({",".join(ids)}); defaultConfigurationIsVisible = 0; defaultConfigurationName = Release; }}')
native = add('target', f'{{isa = PBXNativeTarget; buildConfigurationList = {configs["target"]}; buildPhases = ({sources},{frameworks},{resource_phase}); buildRules = (); dependencies = (); name = SpentOn; productName = SpentOn; productReference = {app}; productType = "com.apple.product-type.application"; }}')
test_ref = add('ui-test-ref', '{isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = UITests/SpentOnUITests.swift; sourceTree = "<group>"; }')
test_file = add('ui-test-file', f'{{isa = PBXBuildFile; fileRef = {test_ref}; }}')
test_sources = add('ui-test-sources', f'{{isa = PBXSourcesBuildPhase; buildActionMask = 2147483647; files = ({test_file}); runOnlyForDeploymentPostprocessing = 0; }}')
test_product = add('ui-test-product', '{isa = PBXFileReference; explicitFileType = wrapper.cfbundle; path = SpentOnUITests.xctest; sourceTree = BUILT_PRODUCTS_DIR; }')
test_configs = []
for mode in ['Debug', 'Release']:
    test_configs.append(add('uitest' + mode, f'{{isa = XCBuildConfiguration; buildSettings = {{PRODUCT_BUNDLE_IDENTIFIER = dev.spenton.ios.uitests; PRODUCT_NAME = SpentOnUITests; GENERATE_INFOPLIST_FILE = YES; TEST_TARGET_NAME = SpentOn; TARGETED_DEVICE_FAMILY = "1,2"; CODE_SIGN_STYLE = Automatic; }}; name = {mode}; }}'))
test_config = add('uitestconfigs', f'{{isa = XCConfigurationList; buildConfigurations = ({",".join(test_configs)}); defaultConfigurationIsVisible = 0; defaultConfigurationName = Release; }}')
proxy = add('testproxy', f'{{isa = PBXContainerItemProxy; containerPortal = {uid("project")}; proxyType = 1; remoteGlobalIDString = {native}; remoteInfo = SpentOn; }}')
dependency = add('testdependency', f'{{isa = PBXTargetDependency; target = {native}; targetProxy = {proxy}; }}')
uitest = add('uitesttarget', f'{{isa = PBXNativeTarget; buildConfigurationList = {test_config}; buildPhases = ({test_sources}); buildRules = (); dependencies = ({dependency}); name = SpentOnUITests; productName = SpentOnUITests; productReference = {test_product}; productType = "com.apple.product-type.bundle.ui-testing"; }}')
add('products', f'{{isa = PBXGroup; children = ({app},{test_product}); name = Products; sourceTree = "<group>"; }}')
add('group', f'{{isa = PBXGroup; children = ({",".join(refs + [test_ref, products])}); sourceTree = "<group>"; }}')
project_id = add('project', f'{{isa = PBXProject; attributes = {{LastSwiftUpdateCheck = 2660; LastUpgradeCheck = 2660;}}; buildConfigurationList = {configs["project"]}; compatibilityVersion = "Xcode 14.0"; developmentRegion = en; hasScannedForEncodings = 0; knownRegions = (en,Base); mainGroup = {group}; productRefGroup = {products}; projectDirPath = ""; projectRoot = ""; targets = ({native},{uitest}); }}')
(project / 'project.pbxproj').write_text('// !$*UTF8*$!\n{archiveVersion = 1; classes = {}; objectVersion = 56; objects = {\n' + '\n'.join(f'{key} = {value};' for key, value in objects.items()) + f'\n}}; rootObject = {project_id}; }}\n')
schemes = project / 'xcshareddata/xcschemes'
schemes.mkdir(parents=True, exist_ok=True)
reference = f'<BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{native}" BuildableName="SpentOn.app" BlueprintName="SpentOn" ReferencedContainer="container:SpentOn.xcodeproj"/>'
(schemes / 'SpentOn.xcscheme').write_text(f'''<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion="2660" version="1.3"><BuildAction parallelizeBuildables="YES" buildImplicitDependencies="YES"><BuildActionEntries><BuildActionEntry buildForTesting="YES" buildForRunning="YES" buildForProfiling="YES" buildForArchiving="YES" buildForAnalyzing="YES">{reference}</BuildActionEntry></BuildActionEntries></BuildAction><LaunchAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" launchStyle="0" useCustomWorkingDirectory="NO" ignoresPersistentStateOnLaunch="NO" debugDocumentVersioning="YES" allowLocationSimulation="YES"><BuildableProductRunnable runnableDebuggingMode="0">{reference}</BuildableProductRunnable></LaunchAction><ProfileAction buildConfiguration="Release" shouldUseLaunchSchemeArgsEnv="YES" savedToolIdentifier="" useCustomWorkingDirectory="NO" debugDocumentVersioning="YES"><BuildableProductRunnable runnableDebuggingMode="0">{reference}</BuildableProductRunnable></ProfileAction><AnalyzeAction buildConfiguration="Debug"/><ArchiveAction buildConfiguration="Release" revealArchiveInOrganizer="YES"/></Scheme>''')
scheme = schemes / 'SpentOn.xcscheme'
scheme.write_text(scheme.read_text().replace('</BuildAction>', f'</BuildAction><TestAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" shouldUseLaunchSchemeArgsEnv="YES"><Testables><TestableReference skipped="NO"><BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{uitest}" BuildableName="SpentOnUITests.xctest" BlueprintName="SpentOnUITests" ReferencedContainer="container:SpentOn.xcodeproj"/></TestableReference></Testables></TestAction>'))
print(project)
