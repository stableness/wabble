import {
    function as F,
    reader as Rd,
} from 'fp-ts';

import * as Rx from 'rxjs';

import type { Service } from '../config.js';

import { httpProxy } from './http.js';
import { socks5Proxy } from './socks5.js';

export { establish } from './api.js';





type Proxies = ReturnType<typeof httpProxy | typeof socks5Proxy>;

export type Hook = Rx.ObservedValueOf<ReturnType<Proxies>>['hook'];





export const combine = F.flow(
    Rd.traverseArray(box),
    Rd.map(services => Rx.merge(...services)),
);





export function box (service: Service) {

    const { protocol } = service;

    if (protocol === 'http') {
        return httpProxy(service);
    }

    if (protocol === 'socks5') {
        return socks5Proxy(service);
    }

    throw new Error(`Non supported protocol [${ protocol }]`);

}

