'use strict';
/* eslint-disable max-len */
/* eslint-disable @typescript-eslint/no-var-requires */

const Command = require('command-line-args') as typeof import('command-line-args');

const { load } = require('./index.cjs') as typeof import('./index');





export type Options = typeof options;

const options = Command([

    { name: 'setting', alias: 's', type: String, defaultValue: 'setting.yml', defaultOption: true },
    { name: 'version', alias: 'v', type: Boolean },
    { name: 'logging', alias: 'l', type: String },
    { name: 'quiet',   alias: 'q', type: Boolean },

]) as {
    setting: string;
    version?: boolean;
    logging?: string;
    quiet?: boolean;
};





load(options);

