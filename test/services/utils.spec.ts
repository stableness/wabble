import { Readable } from 'stream';

import {
    option as O,
    either as E,
    function as F,
} from 'fp-ts';

import * as R from 'ramda';

import {
    run as force,
    readToTaskEither,
    type CurryT,
} from '../../src/utils/index.js';

import {

    readFrame,
    do_not_require,
    do_not_have_authentication,
    date_to_dump_name,

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





describe('date_to_dump_name', () => {

    type S = string;

    const sample: CurryT<[ S, S, S, S, S, [ S, S ] ]>
    = y => m => d => time => p => F.tuple(
        `${ y }-${ m }-${ d }T${ time }.000Z`,
        `Heap-${ y }${ m }${ d }-${ time.replace(/:/g, '') }-${ p }.heapsnapshot`,
    );

    const pid = '42';

    const the = date_to_dump_name(pid);



    test.each([

        sample ('2018') ('01') ('05') ('00:00:00') (pid),
        sample ('2022') ('04') ('13') ('10:20:30') (pid),

    ])('%s', (iso, dump) => {

        expect(the(new Date(iso))).toEqual(dump);

    });

});

