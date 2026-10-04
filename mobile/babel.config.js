const path = require('path')

module.exports = function (api) {
  api.cache(true)
  return {
    presets: [
      ['babel-preset-expo', { jsxImportSource: 'nativewind' }],
      'nativewind/babel',
    ],
    plugins: [
      // `@` is this app's own source — the shared core (types, the event
      // reducer, the pure derivations) lives in src/lib and src/types, so the
      // phone builds standalone. `@app` is the same tree by its other name.
      // Both babel (bundling) and tsconfig (types) use the same mapping.
      [
        'module-resolver',
        {
          extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
          alias: {
            '@': path.resolve(__dirname, './src'),
            '@app': path.resolve(__dirname, './src'),
          },
        },
      ],
    ],
  }
}
