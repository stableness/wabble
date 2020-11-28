import path from 'path';

import * as R from 'ramda';





const join = R.apply(path.join);

export const paths =
    (...init: string[]) =>
        (name: string) =>
            join(init.concat(name))
;

