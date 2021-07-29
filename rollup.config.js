// @ts-check

import { defineConfig } from 'rollup';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';
import { terser } from 'rollup-plugin-terser';
import visualizer from 'rollup-plugin-visualizer';

import * as R from 'ramda';





const { OUT = './dist' } = process.env;

export const logs = R.tap(console.log);
export const path = R.compose(R.replace(/\/\/+/g, '/'), R.join('/'));
export const dist = R.compose(path, R.prepend(OUT), R.of, R.trim);
export const list = R.compose(R.filter(Boolean), R.split(/[,|;]|\s+/g), R.trim);

export const builtin = list(`
    | http | https | tls | net | crypto | stream | buffer | querystring |
    | util | os | events | url | fs | assert | vm | v8 | dns |
`);



export default defineConfig({

    input: dist('bin.js'),

    external: builtin,

    output: {
        format: 'cjs',
        exports: 'named',
        preferConst: true,
        interop: false,
        file: dist('bin.cjs'),
        banner: '#!/usr/bin/env node',
    },

    treeshake: {
        moduleSideEffects: false,
        propertyReadSideEffects: false,
    },

    onwarn (warning, warn) {

        const ignores = R.flip(R.includes)(list(`
            THIS_IS_UNDEFINED
            CIRCULAR_DEPENDENCY
        `));

        R.ifElse(
            R.o(ignores, R.prop('code')),
            R.F,
            warn,
        )(warning);

    },

    plugins: [
        resolve(),
        commonjs({
            include: [
                'node_modules/**'
            ],
            ignore: ['pino-pretty'],
            sourceMap: false,
        }),
        json(),
        visualizer({
            filename: dist('stats.html'),
        }),
        terser({
            ecma: 2019,
            toplevel: true,
            compress: {
                inline: false,
                unsafe_arrows: false,
                unsafe_methods: false,
                keep_fnames: true,
                keep_classnames: true,
            },
        }),
    ],

});

