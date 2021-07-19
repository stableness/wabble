import pino from 'pino';

import type { Service } from '../../src/config';
import type { Logging } from '../../src/model';

import {

    box,

} from '../../src/services/index';





describe('box', () => {

    test('non supported protocol to throw', () => {

        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-expect-error
        const service = { protocol: 'waaaaaat' } as Service;

        expect(() => box(service)).toThrowError();

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

