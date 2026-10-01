#!/usr/bin/env node
/**
 * Fails the build if an `Animated.Value` reaches a NON-`Animated` element's props.
 *
 * WHY THIS EXISTS
 * ---------------
 * React Native 0.86's Fabric dev renderer deep-freezes and *seals* every host
 * component prop named in the view config — `style` included — and the freeze
 * recurses into the values:
 *
 *   Object.freeze(object); Object.seal(object);
 *   for (key of keys) deepFreezeAndThrowOnMutationInDev(object[key]);
 *   Libraries/Utilities/deepFreezeAndThrowOnMutationInDev.js
 *   called from Libraries/Renderer/implementations/ReactFabric-dev.js
 *
 * An `Animated.Value` is mutable by design: `AnimatedValue.stopTracking()` does
 * `this._tracking = null`, and `_tracking` is not initialised in the
 * constructor. Hand a raw value to a plain `View` and the renderer seals it, so
 * the next `animation.start()` throws:
 *
 *   Render Error — Cannot add new property '_tracking'
 *
 * `Animated.View` does not have this problem: it resolves its values into
 * numbers before the host ever sees the props. So the rule is simply that an
 * animated style belongs on an `Animated.*` component — which is also the
 * documented React Native idiom, and the thing this script enforces.
 *
 * That failure is dev-only and looks like a mysterious crash on the first
 * screen, which is exactly the kind of thing worth failing a build over.
 *
 * Allowed: `Animated.View`, `Animated.ScrollView`, anything `Animated.`-prefixed.
 * Run: node scripts/check-motion.mjs
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')

/** Style helpers that return something containing an `Animated.Value`. */
const HELPERS = ['enterStyle(', 'rowEnterStyle(', 'popStyle(']

/** Values from the layout hooks, which are also `Animated.Value`s. */
const HOOK_VALUE = /\b(collapse|disclosure|shimmer)\.?[A-Za-z]*\.style\b/

const TAG = /<([A-Za-z][A-Za-z0-9._]*)\b/g

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (/\.tsx?$/.test(entry)) out.push(full)
  }
  return out
}

const files = [...walk(join(root, 'src')), join(root, 'App.tsx')]
const problems = []

for (const file of files) {
  const lines = readFileSync(file, 'utf8').split('\n')
  lines.forEach((line, index) => {
    const usesHelper = HELPERS.some((helper) => line.includes(helper))
    const usesHookValue = line.includes('style={') && HOOK_VALUE.test(line)
    if (!usesHelper && !usesHookValue) return

    // The nearest opening tag above this line owns the style.
    let owner = null
    for (let back = index; back >= 0 && back > index - 30; back--) {
      const matches = [...lines[back].matchAll(TAG)]
      if (matches.length > 0) {
        owner = matches[matches.length - 1][1]
        break
      }
    }

    if (owner && !owner.startsWith('Animated.')) {
      problems.push({ file: relative(root, file), line: index + 1, owner })
    }
  })
}

if (problems.length > 0) {
  console.error('\x1b[31mfail\x1b[0m  animated style on a non-Animated element:\n')
  for (const p of problems) {
    console.error(`  ${p.file}:${p.line}  <${p.owner}>`)
  }
  console.error(
    '\n  An Animated.Value in a plain element\'s props gets sealed by the dev\n' +
      '  renderer, and the next animation.start() throws "Cannot add new\n' +
      '  property \'_tracking\'". Use Animated.View instead.\n',
  )
  process.exit(1)
}

console.log(`\x1b[32mok\x1b[0m  every animated style sits on an Animated component (${files.length} files)`)