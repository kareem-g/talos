const path = require('path')

module.exports = function (api) {
  api.cache(true)
  return {
    presets: [
      ['babel-preset-expo', { jsxImportSource: 'nativewind' }],
      'nativewind/babel',
    ],
    plugins: [
      // `@` resolves to the web dashboard's source so the framework-agnostic
      // core (types, the event reducer, and the pure derivations) is shared
      // verbatim instead of copied. `@app` is this app's own source. Both babel
      // (bundling) and tsconfig (types) use the same mapping.
      [
        'module-resolver',
        {
          extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
          alias: {
            '@': path.resolve(__dirname, '../dashboard/src'),
            '@app': path.resolve(__dirname, './src'),
          },
        },
      ],
    ],
  }
}
