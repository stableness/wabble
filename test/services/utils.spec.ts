import { Readable } from 'stream';

import {
    option as O,
    either as E,
} from 'fp-ts';

import * as R from 'ramda';

import {
    run as force,
    readToTaskEither,
} from '../../src/utils/index.js';

import {

    readFrame,
    do_not_require,
    do_not_have_authentication,

} from '../../src/services/utils.js';





describe('do_not_require', () => {

    test('have auth', () => {
        expect(do_not_require(O.some('auth'))).toBe(false);
    });

    test('have no auth', () => {
        expect(do_not_require(O.none)).toBe(true);
    });

});





describe('do_not_have_authentication', () => {

    test.each([

        [ [               ] ],
        [ [    1,    3    ] ],
        [ [ 0, 1,    3, 4 ] ],

    ])('no 0x02 in %p', methods => {
        expect(do_not_have_authentication(methods)).toBe(true);
    });

    test.each([

        [ [       2       ] ],
        [ [    1, 2, 3    ] ],
        [ [ 0, 1, 2, 3, 4 ] ],

    ])('have 0x02 in %p', methods => {
        expect(do_not_have_authentication(methods)).toBe(false);
    });

});





describe('readFrame', () => {

    test('right', async () => {

        const size = 5;
        const content = Buffer.from(R.range(0, size));

        const read = readToTaskEither(Readable.from(
            force(function* () {
                yield Buffer.of(size);
                yield content;
            }),
            { objectMode: false },
        ));

        const result = await force(readFrame(read));

        expect(result).toStrictEqual(E.right(content));

    });

    test('left', async () => {

        const error = new Error('oops');

        const read = readToTaskEither(Readable.from(
            force(function* () {
                throw error;
                yield 1;
            }),
            { objectMode: false },
        ));

        const result = await force(readFrame(read));

        expect(result).toStrictEqual(E.left(error));

    });

});

