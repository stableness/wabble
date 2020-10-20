'use strict';
/* eslint-disable @typescript-eslint/no-var-requires */

const { ArgumentParser } = require('argparse') as typeof import('argparse');

const { load } = require('./index.cjs') as typeof import('./index');





const parser = new ArgumentParser({
    prog: 'wabble',
    add_help: true,
});

export interface Options {
    setting: string;
    version?: boolean;
    logging?: string;
    quiet?: boolean;
}

parser.add_argument('-s', '--setting', {
    default: 'setting.yml',
    help: 'default to setting.yml',
});

parser.add_argument('-l', '--logging', {
    action: 'store',
    help: 'one of: trace debug info warn error fatal silent',
});

parser.add_argument('-v', '--version', {
    action: 'store_true',
    help: 'print version',
});

parser.add_argument('-q', '--quiet', {
    action: 'store_true',
    help: 'suppress logging',
});





load(parser.parse_args());

