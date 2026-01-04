import commonjs from "@rollup/plugin-commonjs"
import {nodeResolve} from "@rollup/plugin-node-resolve"
import dts from 'rollup-plugin-dts';
import terser from '@rollup/plugin-terser';
import typescript from '@rollup/plugin-typescript';
import { assert } from "console";

export default [
  {
    input: 'ts/cm6-clj-smart-indent.ts',
    external: ['assert',
               '@codemirror/state',
               '@codemirror/language',
               '@nextjournal/lezer-clojure'],
    output: [
      {
        file: 'dist/cm6-clj-smart-indent.js',
        format: 'esm',
        sourcemap: false
      },
      {
        file: 'dist/cm6-clj-smart-indent.min.js',
        format: 'esm',
        plugins: [terser()],
        sourcemap: false
      }
    ],
    plugins: [
      typescript({
        sourceMap: false,
      }),
      nodeResolve(),
      commonjs({
        ignore: ['assert']
      })
    ]
  },
  {
    input: 'dist/cm6-clj-smart-indent.d.ts',
    output: {
      file: 'dist/cm6-clj-smart-indent.d.ts',
      format: 'esm',
    },
    plugins: [dts()],
  }
];
