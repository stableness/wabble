import type { Service } from '../../src/config';

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

