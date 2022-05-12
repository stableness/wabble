import {
    describe, test, expect,
} from '@jest/globals';

import {
    option as O,
} from 'fp-ts';

import * as Rx from 'rxjs';

import pino from 'pino';

import type { Service } from '../../src/config.js';
import type { Logging } from '../../src/model.js';

import {

    box,
    combine,

} from '../../src/services/index.js';





describe('box', () => {

    test('non supported protocol to throw', () => {

        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-expect-error
        const service = { protocol: 'waaaaaat' } as Service;

        expect(() => box(service)).toThrowError();

    });

});





describe('combine', () => {

    test('smoking', () => {

        const proxy = combine([

            {
                protocol: 'http',
                auth: O.none,
                host: 'localhost',
                port: 0,
            },

            {
                protocol: 'socks5',
                auth: O.none,
                host: 'localhost',
                port: 0,
            },

        ]);

        const obs = proxy(genLogging());

        expect(Rx.isObservable(obs)).toBe(true);

    });

});





export function genLogging ({ debug = false, warn = false } = {}): Logging {

    return {

        logger: pino({
            base: null,
            prettyPrint: false,
            enabled: false,
        }),

        logLevel: {
            on: {
                warn, debug,
                trace: false, info: false,
                error: false, fatal: false,
                silent: false,
            } as const,
        },

    };

}

