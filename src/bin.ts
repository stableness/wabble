import Command from 'command-line-args';

import { load } from './index.js';





export type Options = typeof options;

const options = Command([

    /* eslint-disable-next-line max-len */
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

