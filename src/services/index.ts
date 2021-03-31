import {
    function as F,
    reader as Rd,
} from 'fp-ts';

import * as Rx from 'rxjs';

import type { Service } from '../config';

import { httpProxy } from './http';
import { socks5Proxy } from './socks5';

export { establish } from './api';





type Proxy = ReturnType<typeof httpProxy | typeof socks5Proxy>;

export type Hook = Rx.ObservedValueOf<ReturnType<Proxy>>['hook'];





export const combine = F.flow(
    Rd.traverseArray(box),
    Rd.map(services => Rx.merge(...services)),
);





export function box (service: Service) {

    const { protocol } = service;

    if (protocol === 'http') {
        return httpProxy(service);
    }

    if (protocol === 'socks5' as string) {
        return socks5Proxy(service);
    }

    // eslint-disable-next-line functional/no-throw-statement
    throw new Error(`Non supported protocol [${ protocol }]`);

}

