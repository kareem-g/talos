#!/usr/bin/env python3
"""Generate the AgentDeck Xcode project.

Emits `ios/AgentDeck.xcodeproj/project.pbxproj` (classic format,
objectVersion 56 — opens in Xcode 14+) and the shared build/test scheme.
Run from anywhere; paths are resolved relative to this file.

    python3 ios/tools/generate_project.py

Re-run whenever Swift files are added or removed; the file references are
mirrored from the directory tree.
"""

import hashlib
import os
import re


SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
IOS_DIR = os.path.dirname(SCRIPT_DIR)
REPO_ROOT = os.path.dirname(IOS_DIR)
PROJECT_DIR = os.path.join(IOS_DIR, "AgentDeck.xcodeproj")

APP_NAME = "AgentDeck"
TEST_NAME = "AgentDeckTests"
BUNDLE_ID = "com.agentdeck.ios"
DEPLOYMENT_TARGET = "17.0"
SWIFT_VERSION = "5.0"

# Deterministic 24-hex-char Xcode object IDs, stable across regenerations.
def object_id(name: str) -> str:
    import hashlib

    return hashlib.md5(f"agentdeck-{name}".encode()).hexdigest()[:24].upper()


def collect_swift_files(group_dir: str) -> dict[str, list[str]]:
    """Map of subdirectory ("" for the root) -> swift file names.
    Directories without Swift files (e.g. Assets.xcassets) are not groups."""
    result: dict[str, list[str]] = {"": []}
    for entry in sorted(os.listdir(group_dir)):
        full = os.path.join(group_dir, entry)
        if entry.endswith(".swift"):
            result[""].append(entry)
        elif os.path.isdir(full):
            swift = sorted(f for f in os.listdir(full) if f.endswith(".swift"))
            if swift:
                result[entry] = swift
    return result


def quote(value: str) -> str:
    if re.fullmatch(r"[A-Za-z0-9_./]+", value or ""):
        return value
    return f'"{value}"'


def plist_value(value: str) -> str:
    """Build-setting value in old-style plist syntax.

    The pbxproj parser is an OpenStep-format plist: `(`, `)`, `$`, `-`, and
    spaces are not safe in unquoted strings, so anything that is not a plain
    token is quoted. Xcode itself quotes every variable expansion
    ("$(inherited)", "$(TARGET_NAME)"). Composite (parenthesized) values are
    passed through already-formatted.
    """
    if value.startswith("("):
        return value
    return quote(value)


class Project:
    def __init__(self) -> None:
        self.app_sources = collect_swift_files(os.path.join(IOS_DIR, APP_NAME))
        self.test_sources = collect_swift_files(os.path.join(IOS_DIR, TEST_NAME))
        self.sections: list[str] = []

        # IDs
        self.id_project = object_id("project")
        self.id_main_group = object_id("main-group")
        self.id_products_group = object_id("products-group")
        self.id_app_group = object_id("app-group")
        self.id_test_group = object_id("test-group")
        self.id_app_target = object_id("app-target")
        self.id_test_target = object_id("test-target")
        self.id_app_product = object_id("app-product")
        self.id_test_product = object_id("test-product")
        self.id_app_sources_phase = object_id("app-sources-phase")
        self.id_app_resources_phase = object_id("app-resources-phase")
        self.id_app_frameworks_phase = object_id("app-frameworks-phase")
        self.id_test_sources_phase = object_id("test-sources-phase")
        self.id_test_frameworks_phase = object_id("test-frameworks-phase")
        self.id_dependency = object_id("dependency")
        self.id_proxy = object_id("proxy")
        self.id_assets = object_id("assets")
        self.id_infoplist = object_id("infoplist")
        self.id_cfglist_project = object_id("cfglist-project")
        self.id_cfglist_app = object_id("cfglist-app")
        self.id_cfglist_test = object_id("cfglist-test")

        # Source file refs and build files
        self.file_refs: list[tuple[str, str]] = []  # (id, path) for pbxproj emission
        self.app_build_files: list[str] = []
        self.test_build_files: list[str] = []
        self.subgroup_ids: dict[str, str] = {}

    def file_ref_id(self, path: str) -> str:
        return object_id(f"file:{path}")

    # MARK: Emission

    def emit_build_file_section(self) -> str:
        lines = ["/* Begin PBXBuildFile section */"]
        for path in self.all_source_paths():
            ref = self.file_ref_id(path)
            name = os.path.basename(path)
            build = object_id(f"build:{path}")
            lines.append(
                f"\t\t{build} /* {name} in Sources */ = {{isa = PBXBuildFile; fileRef = {ref} /* {name} */; }};"
            )
            if path.startswith(f"{APP_NAME}/"):
                self.app_build_files.append(build)
            elif path.startswith(f"{TEST_NAME}/"):
                self.test_build_files.append(build)
        assets_build = object_id("build:assets")
        lines.append(
            f"\t\t{assets_build} /* Assets.xcassets in Resources */ = {{isa = PBXBuildFile; fileRef = {self.id_assets} /* Assets.xcassets */; }};"
        )
        self.assets_build = assets_build
        lines.append("/* End PBXBuildFile section */")
        return "\n".join(lines)

    def all_source_paths(self) -> list[str]:
        paths: list[str] = []
        for subdir, files in self.app_sources.items():
            prefix = f"{APP_NAME}/{subdir}" if subdir else APP_NAME
            for file in files:
                paths.append(f"{prefix}/{file}")
        for subdir, files in self.test_sources.items():
            prefix = f"{TEST_NAME}/{subdir}" if subdir else TEST_NAME
            for file in files:
                paths.append(f"{prefix}/{file}")
        return paths

    def emit_file_reference_section(self) -> str:
        lines = ["/* Begin PBXFileReference section */"]
        for path in self.all_source_paths():
            ref = self.file_ref_id(path)
            name = os.path.basename(path)
            # The path is relative to the containing group; subdirectories are
            # modeled as groups, so the file's path is just its name.
            lines.append(
                f"\t\t{ref} /* {name} */ = {{isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = {quote(name)}; sourceTree = \"<group>\"; }};"
            )
        lines.append(
            f"\t\t{self.id_assets} /* Assets.xcassets */ = {{isa = PBXFileReference; lastKnownFileType = folder.assetcatalog; path = Assets.xcassets; sourceTree = \"<group>\"; }};"
        )
        lines.append(
            f"\t\t{self.id_infoplist} /* Info.plist */ = {{isa = PBXFileReference; lastKnownFileType = text.plist.xml; path = Info.plist; sourceTree = \"<group>\"; }};"
        )
        lines.append(
            f"\t\t{self.id_app_product} /* {APP_NAME}.app */ = {{isa = PBXFileReference; explicitFileType = wrapper.application; includeInIndex = 0; path = {APP_NAME}.app; sourceTree = BUILT_PRODUCTS_DIR; }};"
        )
        lines.append(
            f"\t\t{self.id_test_product} /* {TEST_NAME}.xctest */ = {{isa = PBXFileReference; explicitFileType = wrapper.cfbundle; includeInIndex = 0; path = {TEST_NAME}.xctest; sourceTree = BUILT_PRODUCTS_DIR; }};"
        )
        lines.append("/* End PBXFileReference section */")
        return "\n".join(lines)

    def emit_build_phase_sections(self) -> str:
        app_files = "\n".join(
            f"\t\t\t\t{build} /* {os.path.basename(path)} in Sources */,"
            for build, path in zip(self.app_build_files, self.app_paths())
        )
        test_files = "\n".join(
            f"\t\t\t\t{build} /* {os.path.basename(path)} in Sources */,"
            for build, path in zip(self.test_build_files, self.test_paths())
        )
        return f"""/* Begin PBXFrameworksBuildPhase section */
\t\t{self.id_app_frameworks_phase} /* Frameworks */ = {{
\t\t\tisa = PBXFrameworksBuildPhase;
\t\t\tbuildActionMask = 2147483647;
\t\t\tfiles = (
\t\t\t);
\t\t\trunOnlyForDeploymentPostprocessing = 0;
\t\t}};
\t\t{self.id_test_frameworks_phase} /* Frameworks */ = {{
\t\t\tisa = PBXFrameworksBuildPhase;
\t\t\tbuildActionMask = 2147483647;
\t\t\tfiles = (
\t\t\t);
\t\t\trunOnlyForDeploymentPostprocessing = 0;
\t\t}};
/* End PBXFrameworksBuildPhase section */
/* Begin PBXResourcesBuildPhase section */
\t\t{self.id_app_resources_phase} /* Resources */ = {{
\t\t\tisa = PBXResourcesBuildPhase;
\t\t\tbuildActionMask = 2147483647;
\t\t\tfiles = (
\t\t\t\t{self.assets_build} /* Assets.xcassets in Resources */,
\t\t\t);
\t\t\trunOnlyForDeploymentPostprocessing = 0;
\t\t}};
/* End PBXResourcesBuildPhase section */
/* Begin PBXSourcesBuildPhase section */
\t\t{self.id_app_sources_phase} /* Sources */ = {{
\t\t\tisa = PBXSourcesBuildPhase;
\t\t\tbuildActionMask = 2147483647;
\t\t\tfiles = (
{app_files}
\t\t\t);
\t\t\trunOnlyForDeploymentPostprocessing = 0;
\t\t}};
\t\t{self.id_test_sources_phase} /* Sources */ = {{
\t\t\tisa = PBXSourcesBuildPhase;
\t\t\tbuildActionMask = 2147483647;
\t\t\tfiles = (
{test_files}
\t\t\t);
\t\t\trunOnlyForDeploymentPostprocessing = 0;
\t\t}};
/* End PBXSourcesBuildPhase section */"""

    def app_paths(self) -> list[str]:
        return [p for p in self.all_source_paths() if p.startswith(f"{APP_NAME}/")]

    def test_paths(self) -> list[str]:
        return [p for p in self.all_source_paths() if p.startswith(f"{TEST_NAME}/")]

    def emit_group_section(self) -> str:
        def group_children(mapping: dict[str, list[str]], base: str) -> str:
            children: list[str] = []
            # Files at the root of the group first.
            for file in mapping.get("", []):
                children.append(
                    f"\t\t\t\t{self.file_ref_id(f'{base}/{file}')} /* {file} */,"
                )
            if base == APP_NAME:
                children.append(f"\t\t\t\t{self.id_assets} /* Assets.xcassets */,")
                children.append(f"\t\t\t\t{self.id_infoplist} /* Info.plist */,")
            # Then subgroups, alphabetically.
            for subdir in sorted(k for k in mapping if k):
                subgroup_id = object_id(f"group:{base}/{subdir}")
                self.subgroup_ids[subdir] = subgroup_id
                children.append(f"\t\t\t\t{subgroup_id} /* {subdir} */,")
            return "\n".join(children)

        subgroup_definitions: list[str] = []
        for mapping, base in ((self.app_sources, APP_NAME), (self.test_sources, TEST_NAME)):
            for subdir in sorted(k for k in mapping if k):
                subgroup_id = object_id(f"group:{base}/{subdir}")
                file_lines = "\n".join(
                    f"\t\t\t\t{self.file_ref_id(f'{base}/{subdir}/{file}')} /* {file} */,"
                    for file in mapping[subdir]
                )
                subgroup_definitions.append(
                    f"\t\t{subgroup_id} /* {subdir} */ = {{\n"
                    f"\t\t\tisa = PBXGroup;\n"
                    f"\t\t\tchildren = (\n{file_lines}\n\t\t\t);\n"
                    f"\t\t\tpath = {quote(subdir)};\n"
                    f"\t\t\tsourceTree = \"<group>\";\n"
                    f"\t\t}};"
                )

        return f"""/* Begin PBXGroup section */
\t\t{self.id_app_group} /* {APP_NAME} */ = {{
\t\t\tisa = PBXGroup;
\t\t\tchildren = (
{group_children(self.app_sources, APP_NAME)}
\t\t\t);
\t\t\tpath = {APP_NAME};
\t\t\tsourceTree = "<group>";
\t\t}};
\t\t{self.id_test_group} /* {TEST_NAME} */ = {{
\t\t\tisa = PBXGroup;
\t\t\tchildren = (
{group_children(self.test_sources, TEST_NAME)}
\t\t\t);
\t\t\tpath = {TEST_NAME};
\t\t\tsourceTree = "<group>";
\t\t}};
\t\t{self.id_products_group} /* Products */ = {{
\t\t\tisa = PBXGroup;
\t\t\tchildren = (
\t\t\t\t{self.id_app_product} /* {APP_NAME}.app */,
\t\t\t\t{self.id_test_product} /* {TEST_NAME}.xctest */,
\t\t\t);
\t\t\tname = Products;
\t\t\tsourceTree = "<group>";
\t\t}};
\t\t{self.id_main_group} = {{
\t\t\tisa = PBXGroup;
\t\t\tchildren = (
\t\t\t\t{self.id_app_group} /* {APP_NAME} */,
\t\t\t\t{self.id_test_group} /* {TEST_NAME} */,
\t\t\t\t{self.id_products_group} /* Products */,
\t\t\t);
\t\t\tsourceTree = "<group>";
\t\t}};
{chr(10).join(subgroup_definitions)}
/* End PBXGroup section */"""

    def emit_target_and_project_section(self) -> str:
        return f"""/* Begin PBXContainerItemProxy section */
\t\t{self.id_proxy} /* PBXContainerItemProxy */ = {{
\t\t\tisa = PBXContainerItemProxy;
\t\t\tcontainerPortal = {self.id_project} /* Project object */;
\t\t\tproxyType = 1;
\t\t\tremoteGlobalIDString = {self.id_app_target};
\t\t\tremoteInfo = {APP_NAME};
\t\t}};
/* End PBXContainerItemProxy section */
/* Begin PBXNativeTarget section */
\t\t{self.id_app_target} /* {APP_NAME} */ = {{
\t\t\tisa = PBXNativeTarget;
\t\t\tbuildConfigurationList = {self.id_cfglist_app} /* Build configuration list for PBXNativeTarget "{APP_NAME}" */;
\t\t\tbuildPhases = (
\t\t\t\t{self.id_app_sources_phase} /* Sources */,
\t\t\t\t{self.id_app_frameworks_phase} /* Frameworks */,
\t\t\t\t{self.id_app_resources_phase} /* Resources */,
\t\t\t);
\t\t\tbuildRules = (
\t\t\t);
\t\t\tdependencies = (
\t\t\t);
\t\t\tname = {APP_NAME};
\t\t\tproductName = {APP_NAME};
\t\t\tproductReference = {self.id_app_product} /* {APP_NAME}.app */;
\t\t\tproductType = "com.apple.product-type.application";
\t\t}};
\t\t{self.id_test_target} /* {TEST_NAME} */ = {{
\t\t\tisa = PBXNativeTarget;
\t\t\tbuildConfigurationList = {self.id_cfglist_test} /* Build configuration list for PBXNativeTarget "{TEST_NAME}" */;
\t\t\tbuildPhases = (
\t\t\t\t{self.id_test_sources_phase} /* Sources */,
\t\t\t\t{self.id_test_frameworks_phase} /* Frameworks */,
\t\t\t);
\t\t\tbuildRules = (
\t\t\t);
\t\t\tdependencies = (
\t\t\t\t{self.id_dependency} /* PBXTargetDependency */,
\t\t\t);
\t\t\tname = {TEST_NAME};
\t\t\tproductName = {TEST_NAME};
\t\t\tproductReference = {self.id_test_product} /* {TEST_NAME}.xctest */;
\t\t\tproductType = "com.apple.product-type.bundle.unit-test";
\t\t}};
/* End PBXNativeTarget section */
/* Begin PBXProject section */
\t\t{self.id_project} /* Project object */ = {{
\t\t\tisa = PBXProject;
\t\t\tbuildConfigurationList = {self.id_cfglist_project} /* Build configuration list for PBXProject "{APP_NAME}" */;
\t\t\tcompatibilityVersion = "Xcode 14.0";
\t\t\tdevelopmentRegion = en;
\t\t\thasScannedForEncodings = 0;
\t\t\tknownRegions = (
\t\t\t\ten,
\t\t\t\tBase,
\t\t\t);
\t\t\tmainGroup = {self.id_main_group};
\t\t\tproductRefGroup = {self.id_products_group} /* Products */;
\t\t\tprojectDirPath = "";
\t\t\tprojectRoot = "";
\t\t\ttargets = (
\t\t\t\t{self.id_app_target} /* {APP_NAME} */,
\t\t\t\t{self.id_test_target} /* {TEST_NAME} */,
\t\t\t);
\t\t\tTargetAttributes = {{
\t\t\t\t{self.id_test_target} = {{
\t\t\t\t\tTestTargetID = {self.id_app_target};
\t\t\t\t}};
\t\t\t}};
\t\t}};
/* End PBXProject section */
/* Begin PBXTargetDependency section */
\t\t{self.id_dependency} /* PBXTargetDependency */ = {{
\t\t\tisa = PBXTargetDependency;
\t\t\ttarget = {self.id_app_target} /* {APP_NAME} */;
\t\t\ttargetProxy = {self.id_proxy} /* PBXContainerItemProxy */;
\t\t}};
/* End PBXTargetDependency section */"""

    def emit_configuration_section(self) -> str:
        project_common = {
            "ALWAYS_SEARCH_USER_PATHS": "NO",
            "CLANG_C_LANGUAGE_STANDARD": "gnu11",
            "CLANG_ENABLE_MODULES": "YES",
            "CLANG_ENABLE_OBJC_ARC": "YES",
            "CURRENT_PROJECT_VERSION": "1",
            "DEAD_CODE_STRIPPING": "YES",
            "GENERATE_INFOPLIST_FILE": "NO",
            "IPHONEOS_DEPLOYMENT_TARGET": DEPLOYMENT_TARGET,
            "MARKETING_VERSION": "1.0.0",
            "PRODUCT_NAME": "$(TARGET_NAME)",
            "SDKROOT": "iphoneos",
            "SUPPORTS_MACCATALYST": "NO",
            "SWIFT_VERSION": SWIFT_VERSION,
            "TARGETED_DEVICE_FAMILY": "1",
        }
        project_debug = {
            "DEBUG_INFORMATION_FORMAT": "dwarf",
            "ENABLE_TESTABILITY": "YES",
            "GCC_OPTIMIZATION_LEVEL": "0",
            "ONLY_ACTIVE_ARCH": "YES",
            "SWIFT_ACTIVE_COMPILATION_CONDITIONS": "$(inherited) DEBUG",
            "SWIFT_OPTIMIZATION_LEVEL": "-Onone",
        }
        project_release = {
            "COPY_PHASE_STRIP": "NO",
            "DEBUG_INFORMATION_FORMAT": "dwarf-with-dsym",
            "ENABLE_NS_ASSERTIONS": "NO",
            "GCC_OPTIMIZATION_LEVEL": "s",
            "ONLY_ACTIVE_ARCH": "NO",
            "SWIFT_COMPILATION_MODE": "wholemodule",
            "SWIFT_OPTIMIZATION_LEVEL": "-O",
            "VALIDATE_PRODUCT": "YES",
        }
        app_settings = {
            "ASSETCATALOG_COMPILER_APPICON_NAME": "AppIcon",
            "ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME": "AccentColor",
            "CODE_SIGN_STYLE": "Automatic",
            "INFOPLIST_FILE": f"{APP_NAME}/Info.plist",
            "LD_RUNPATH_SEARCH_PATHS": '("$(inherited)", "@executable_path/Frameworks")',
            "PRODUCT_BUNDLE_IDENTIFIER": BUNDLE_ID,
        }
        app_debug = {"ENABLE_PREVIEWS": "YES"}
        test_settings = {
            "BUNDLE_LOADER": "$(TEST_HOST)",
            "GENERATE_INFOPLIST_FILE": "YES",
            "LD_RUNPATH_SEARCH_PATHS": '("$(inherited)", "@executable_path/Frameworks", "@loader_path/Frameworks")',
            "PRODUCT_BUNDLE_IDENTIFIER": f"{BUNDLE_ID}.tests",
            "TEST_HOST": f"$(BUILT_PRODUCTS_DIR)/{APP_NAME}.app/$(BUNDLE_EXECUTABLE_FOLDER_PATH)/{APP_NAME}",
        }

        def settings_lines(settings: dict[str, str]) -> str:
            return "\n".join(
                f"\t\t\t\t\t{key} = {plist_value(value)};" for key, value in settings.items()
            )

        def config(cfg_id: str, name: str, settings: dict[str, str], comment: str) -> str:
            return (
                f"\t\t{cfg_id} /* {name} */ = {{\n"
                f"\t\t\tisa = XCBuildConfiguration;\n"
                f"\t\t\tbuildSettings = {{\n{settings_lines(settings)}\n\t\t\t}};\n"
                f"\t\t\tname = {name};\n"
                f"\t\t}};"
            )

        project_debug_id = object_id("cfg-project-debug")
        project_release_id = object_id("cfg-project-release")
        app_debug_id = object_id("cfg-app-debug")
        app_release_id = object_id("cfg-app-release")
        test_debug_id = object_id("cfg-test-debug")
        test_release_id = object_id("cfg-test-release")

        merged_project_debug = {**project_common, **project_debug}
        merged_project_release = {**project_common, **project_release}
        merged_app_debug = {**app_settings, **app_debug}
        merged_app_release = dict(app_settings)
        merged_test_debug = dict(test_settings)
        merged_test_release = dict(test_settings)

        def configuration_list(list_id: str, debug_id: str, release_id: str, comment: str) -> str:
            return (
                f"\t\t{list_id} /* {comment} */ = {{\n"
                f"\t\t\tisa = XCConfigurationList;\n"
                f"\t\t\tbuildConfigurations = (\n"
                f"\t\t\t\t{debug_id} /* Debug */,\n"
                f"\t\t\t\t{release_id} /* Release */,\n"
                f"\t\t\t);\n"
                f"\t\t\tdefaultConfigurationIsVisible = 0;\n"
                f"\t\t\tdefaultConfigurationName = Release;\n"
                f"\t\t}};"
            )

        return f"""/* Begin XCBuildConfiguration section */
{config(project_debug_id, "Debug", merged_project_debug, "Debug configuration for PBXProject")}
{config(project_release_id, "Release", merged_project_release, "Release configuration for PBXProject")}
{config(app_debug_id, "Debug", merged_app_debug, f"Debug configuration for PBXNativeTarget {APP_NAME}")}
{config(app_release_id, "Release", merged_app_release, f"Release configuration for PBXNativeTarget {APP_NAME}")}
{config(test_debug_id, "Debug", merged_test_debug, f"Debug configuration for PBXNativeTarget {TEST_NAME}")}
{config(test_release_id, "Release", merged_test_release, f"Release configuration for PBXNativeTarget {TEST_NAME}")}
/* End XCBuildConfiguration section */
/* Begin XCConfigurationList section */
{configuration_list(self.id_cfglist_project, project_debug_id, project_release_id, f'Build configuration list for PBXProject "{APP_NAME}"')}
{configuration_list(self.id_cfglist_app, app_debug_id, app_release_id, f'Build configuration list for PBXNativeTarget "{APP_NAME}"')}
{configuration_list(self.id_cfglist_test, test_debug_id, test_release_id, f'Build configuration list for PBXNativeTarget "{TEST_NAME}"')}
/* End XCConfigurationList section */"""

    def generate(self) -> None:
        build_file_section = self.emit_build_file_section()
        file_reference_section = self.emit_file_reference_section()
        build_phase_section = self.emit_build_phase_sections()
        group_section = self.emit_group_section()
        target_section = self.emit_target_and_project_section()
        configuration_section = self.emit_configuration_section()

        content = f"""// !$*UTF8*$!
{{
\tarchiveVersion = 1;
\tobjectVersion = 56;
\tclasses = {{
\t}};
\tobjects = {{

{build_file_section}

{file_reference_section}

{build_phase_section}

{group_section}

{target_section}

{configuration_section}
\t}};
\trootObject = {self.id_project} /* Project object */;
}}
"""
        os.makedirs(PROJECT_DIR, exist_ok=True)
        pbxproj_path = os.path.join(PROJECT_DIR, "project.pbxproj")
        with open(pbxproj_path, "w") as handle:
            handle.write(content)
        print(f"wrote {os.path.relpath(pbxproj_path, REPO_ROOT)}")

        self.write_scheme()

    def write_scheme(self) -> None:
        scheme = f"""<?xml version="1.0" encoding="UTF-8"?>
<Scheme
   LastUpgradeVersion = "1490"
   version = "1.7"
   wasCreatedForAppExtension = "NO">
   <BuildAction
      parallelizeBuildables = "YES"
      buildImplicitDependencies = "YES">
      <BuildActionEntries>
         <BuildActionEntry
            buildForTesting = "YES"
            buildForRunning = "YES"
            buildForProfiling = "YES"
            buildForArchiving = "YES"
            buildForAnalyzing = "YES">
            <BuildableReference
               BuildableIdentifier = "primary"
               BlueprintIdentifier = "{self.id_app_target}"
               BuildableName = "{APP_NAME}.app"
               BlueprintName = "{APP_NAME}"
               ReferencedContainer = "container:{APP_NAME}.xcodeproj">
            </BuildableReference>
         </BuildActionEntry>
         <BuildActionEntry
            buildForTesting = "YES"
            buildForRunning = "NO"
            buildForProfiling = "NO"
            buildForArchiving = "NO"
            buildForAnalyzing = "NO">
            <BuildableReference
               BuildableIdentifier = "primary"
               BlueprintIdentifier = "{self.id_test_target}"
               BuildableName = "{TEST_NAME}.xctest"
               BlueprintName = "{TEST_NAME}"
               ReferencedContainer = "container:{APP_NAME}.xcodeproj">
            </BuildableReference>
         </BuildActionEntry>
      </BuildActionEntries>
   </BuildAction>
   <TestAction
      buildConfiguration = "Debug"
      selectedDebuggerIdentifier = "Xcode.DebuggerFoundation.Debugger.LLDB"
      selectedLauncherIdentifier = "Xcode.DebuggerFoundation.Launcher.LLDB"
      shouldUseLaunchSchemeArgsEnv = "YES"
      shouldAutocreateTestPlan = "YES">
      <Testables>
         <TestableReference
            skipped = "NO">
            <BuildableReference
               BuildableIdentifier = "primary"
               BlueprintIdentifier = "{self.id_test_target}"
               BuildableName = "{TEST_NAME}.xctest"
               BlueprintName = "{TEST_NAME}"
               ReferencedContainer = "container:{APP_NAME}.xcodeproj">
            </BuildableReference>
         </TestableReference>
      </Testables>
   </TestAction>
   <LaunchAction
      buildConfiguration = "Debug"
      selectedDebuggerIdentifier = "Xcode.DebuggerFoundation.Debugger.LLDB"
      selectedLauncherIdentifier = "Xcode.DebuggerFoundation.Launcher.LLDB"
      launchStyle = "0"
      useCustomWorkingDirectory = "NO"
      ignoresPersistentStateOnLaunch = "NO"
      debugDocumentVersioning = "YES"
      debugServiceExtension = "internal"
      allowLocationSimulation = "YES">
      <BuildableProductRunnable
         runnableDebuggingMode = "0">
         <BuildableReference
            BuildableIdentifier = "primary"
            BlueprintIdentifier = "{self.id_app_target}"
            BuildableName = "{APP_NAME}.app"
            BlueprintName = "{APP_NAME}"
            ReferencedContainer = "container:{APP_NAME}.xcodeproj">
         </BuildableReference>
      </BuildableProductRunnable>
   </LaunchAction>
   <ProfileAction
      buildConfiguration = "Release"
      shouldUseLaunchSchemeArgsEnv = "YES"
      savedToolIdentifier = ""
      useCustomWorkingDirectory = "NO"
      debugDocumentVersioning = "YES">
      <BuildableProductRunnable
         runnableDebuggingMode = "0">
         <BuildableReference
            BuildableIdentifier = "primary"
            BlueprintIdentifier = "{self.id_app_target}"
            BuildableName = "{APP_NAME}.app"
            BlueprintName = "{APP_NAME}"
            ReferencedContainer = "container:{APP_NAME}.xcodeproj">
         </BuildableReference>
      </BuildableProductRunnable>
   </ProfileAction>
   <AnalyzeAction
      buildConfiguration = "Debug">
   </AnalyzeAction>
   <ArchiveAction
      buildConfiguration = "Release"
      revealArchiveInOrganizer = "YES">
   </ArchiveAction>
</Scheme>
"""
        scheme_dir = os.path.join(PROJECT_DIR, "xcshareddata", "xcschemes")
        os.makedirs(scheme_dir, exist_ok=True)
        scheme_path = os.path.join(scheme_dir, f"{APP_NAME}.xcscheme")
        with open(scheme_path, "w") as handle:
            handle.write(scheme)
        print(f"wrote {os.path.relpath(scheme_path, REPO_ROOT)}")


if __name__ == "__main__":
    Project().generate()
