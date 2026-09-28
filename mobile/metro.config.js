const { getDefaultConfig } = require('expo/metro-config')
const { withNativeWind } = require('nativewind/metro')
const path = require('path')

const projectRoot = __dirname
const workspaceRoot = path.resolve(projectRoot, '..')

const config = getDefaultConfig(projectRoot)

// Monorepo-style resolution: the app imports the shared core straight out of
// ../dashboard/src, so Metro must watch the repo root and be able to resolve
// that code's dependencies (clsx, tailwind-merge, zustand, …) from either the
// mobile or the dashboard node_modules.
config.watchFolders = [workspaceRoot]
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'dashboard', 'node_modules'),
]

module.exports = withNativeWind(config, {
  input: path.resolve(projectRoot, './global.css'),
  configPath: path.resolve(projectRoot, './tailwind.config.js'),
})
