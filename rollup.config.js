// @ts-check

import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';
import replace from '@rollup/plugin-replace';
import { terser } from 'rollup-plugin-terser';
import visualizer from 'rollup-plugin-visualizer';

import * as R from 'ramda';

// @ts-ignore
import pkg from './package.json';





const { OUT = './dist', BUILD = 'dev', NODE_ENV } = process.env;

export const logs = R.tap(console.log);
export const path = R.compose(R.replace(/\/\/+/g, '/'), R.join('/'));
export const dist = R.compose(path, R.prepend(OUT), R.of, R.trim);
export const list = R.compose(R.filter(Boolean), R.split(/[,|;]|\s+/g), R.trim);

export const suffix = R.useWith(R.replace('.js'), [ R.concat('.'), R.identity ]);

export const extendsBuiltin = R.compose(list, R.concat(`
    | http | https | net | crypto | stream | buffer |
    | util | os | events | url | fs | assert | vm |
`));

const devOrProd = R.partialRight(R.ifElse, [ R.identity, R.empty ]);
/** @type { <T> (v: T) => T } */
// @ts-ignore
const dev = devOrProd(R.always(BUILD !== 'prod'));
/** @type { <T> (v: T) => T } */
// @ts-ignore
const prod = devOrProd(R.always(BUILD === 'prod'));

const common = {
    format: 'cjs',
    exports: 'named',
    preferConst: true,
    interop: false,
};



/**
 * @type { import('rollup').RollupOptions[] }
 */
const config = [
    {

        input: dist('index.js'),

        external: extendsBuiltin(dev(`
            | proxy-bind | buffer-pond | async-readable |
            | ramda | ip | futoin-hkdf |
            | js-yaml | pino | command-line-args | basic-auth |

            | rxjs
            | rxjs/operators

            | fp-ts
        `)),

        output: [
            // @ts-ignore
            {
                ...common,
                file: pkg.main,
            },
            {
                file: pkg.esm,
                format: 'esm',
            },
        ],

        treeshake: {
            moduleSideEffects: false,
            propertyReadSideEffects: false,
        },

        onwarn (warning, warn) {
            R.ifElse(
                R.propEq('code', 'CIRCULAR_DEPENDENCY'),
                R.F,
                warn,
            )(warning);
        },

        // @ts-ignore
        plugins: prod([
            resolve(),
            commonjs({
                include: [
                    'node_modules/**'
                ],
                exclude: [
                    'node_modules/pino-pretty/**',
                ],
                sourceMap: false,
                namedExports: {
                    'js-yaml': list(`
                            load |     loadAll |     dump
                        safeLoad | safeLoadAll | safeDump
                    `),
                    'ip': list(`
                        toBuffer | isPrivate | fromLong | toString
                    `),
                }
            }),
            json(),
            visualizer({
                filename: dist('stats.html'),
            }),
        ]).concat([
            replace({
                delimiters: [ '<%=', '=>' ],
                VERSION: pkg.version,
                NODE_ENV: NODE_ENV || 'production',
            }),
        ]),

    },

    // @ts-ignore
    prod({

        input: dist('bin.js'),

        external: extendsBuiltin(''),

        output: {
            ...common,
            file: dist('bin.cjs'),
            banner: '#!/usr/bin/env node',
        },

        plugins: [
            replace({
                include: /bin\.js/,
                'index.cjs': 'index.mjs',
            }),
            resolve(),
            commonjs(),
            terser({
                ecma: 8,
                toplevel: true,
                compress: {
                    inline: false,
                    unsafe_arrows: true,
                    unsafe_methods: true,
                },
            }),
        ],

    }),

];



export default R.reject(R.isEmpty, config);
