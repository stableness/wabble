'use strict';

const Command = require('command-line-args');

const { load } = require('./index.cjs');





export type Options = typeof options;

const options = Command([

    { name: 'setting', alias: 's', type: String, defaultValue: 'setting.yml', defaultOption: true },
    { name: 'version', alias: 'v', type: Boolean },
    { name: 'logging', alias: 'l', type: String },
    { name: 'quiet',   alias: 'q', type: Boolean },

]) as {
    setting: string,
    version?: boolean,
    logging?: string,
    quiet?: boolean,
};





load(options);
