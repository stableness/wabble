import {
    option as O,
} from 'fp-ts';

import {

    do_not_require,
    do_not_have_authentication,

} from '../../src/services/utils';





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

