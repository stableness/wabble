import * as R from 'ramda';

import { option2B } from '../utils';





// :: number[] -> boolean
export const do_not_have_authentication = R.complement(R.includes(0x02));





// :: Option -> boolean
export const do_not_require = R.complement(option2B);

