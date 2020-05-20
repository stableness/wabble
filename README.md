# wabble

[![npm version](https://badgen.net/npm/v/@stableness/wabble)](https://www.npmjs.com/package/@stableness/wabble)
[![actions](https://github.com/stableness/wabble/workflows/Check/badge.svg)](https://github.com/stableness/wabble/actions)
[![codecov](https://codecov.io/gh/stableness/wabble/branch/master/graph/badge.svg)](https://codecov.io/gh/stableness/wabble)
[![vulnerabilities](https://snyk.io/test/npm/@stableness/wabble/badge.svg)](https://snyk.io/test/npm/@stableness/wabble) 





## `setting.yml`

```yaml
version: 1.0



doh: true # 1) [true] enables DoH (via https://cloudflare-dns.com/dns-query)
          # 2) [false] disables DoH
          # 3) or specify another provider's endpoint



services: # local

  # http proxy
  - uri: http://localhost:3000

  # with basic auth - username: admin, password: 123
  - uri: http://admin:123@localhost:3001

  # socks5 proxy
  - uri: socks5://127.0.0.1:3002

  # binding 0.0.0.0 to accept connection from other devices
  - uri: socks5://0.0.0.0:3003



servers: # remote, circular ordering (round-robin)

  # http
  - uri: http://example.org:3128

  # socks5
  - uri: socks5://example.org:1080

  # shadowsocks
  - uri: ss://example.org:4200
    key: this-is-your-password
    alg: aes-128-cfb # optional, default to chacha20-ietf-poly1305

  # trojan
  - uri: trojan://example.org:443
    password: 123456
    ssl: # optional, each fields default as below
      verify: true
      verify_hostname: true
      sni: example.org # default to the hostname in uri on above
      alpn: [ h2, http/1.1 ]
      cipher:
        - ECDHE-ECDSA-AES128-GCM-SHA256
        - ECDHE-RSA-AES128-GCM-SHA256
        - ECDHE-ECDSA-CHACHA20-POLY1305
        - ECDHE-RSA-CHACHA20-POLY1305
        - ECDHE-ECDSA-AES256-GCM-SHA384
        - ECDHE-RSA-AES256-GCM-SHA384
        - ECDHE-ECDSA-AES256-SHA
        - ECDHE-ECDSA-AES128-SHA
        - ECDHE-RSA-AES128-SHA
        - ECDHE-RSA-AES256-SHA
        - DHE-RSA-AES128-SHA
        - DHE-RSA-AES256-SHA
        - AES128-SHA
        - AES256-SHA
        - DES-CBC3-SHA
      cipher_tls13:
        - TLS_AES_128_GCM_SHA256
        - TLS_CHACHA20_POLY1305_SHA256
        - TLS_AES_256_GCM_SHA384



rules:

  proxy:

    # plain text match
    - google

    # prefix with: BEGIN, FULL, END, REG,
    - BEGIN,admin.
    -  FULL,www.instagram.com
    -   END,youtube.com
    -   REG,(www|mobile)\.twitter\.com$

  direct:

    - END,.cn
    - FULL,localhost

    # prepend with DOH, to enable DNS over Https
    - DOH,END,cdninstagram.com

  reject:

    # prepend with NOT to make sure it doesn't gets dropped accidentally
    - NOT,END,.org

    - safebrowsing.urlsec.qq.com

    - doubleclick
    - google-analytics
```





## Templates

- https://github.com/stableness/joggle ([create](https://github.com/stableness/joggle/generate), [download](https://github.com/stableness/joggle/archive/master.zip))

