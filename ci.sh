#!/bin/sh

set -eu



build()
{
    npm run -s build
    echo '#!/usr/bin/env node' > dist/bin.cjs
    cat dist/bin.js >> dist/bin.cjs
}



release()
{
    curl -X PUT -sLo /dev/null https://npm.taobao.org/sync/$(jq -r '.name' package.json)?sync_upstream=true

    PKG=package.json VER=$(jq -r '.version' package.json) TMP=lite.json

    echo ::set-output name=ver::${VER}

    npm run -s bundle && rm dist/index.cjs

    npm shrinkwrap && mv npm-shrinkwrap.json dist/shrinkwrap.json

    jq '{ name, version, bin, files }' ${PKG} > ${TMP} && mv ${TMP} ${PKG}

    npm pack && mv *.tgz dist/wabble-${VER}.tgz && cd dist/

    # npx nexe bin.cjs --target macos-x64-v12.13.1 --name macos-v${VER}-n12

    mkdir artifacts

    mv bin.cjs bin-${VER}.cjs
    mv bin-*.cjs *.json *.tgz artifacts/ && cd artifacts/

    sha256sum *[^.txt] | tee checksum.txt && sha256sum checksum.txt

    ls -lh
}



cd $1 && shift && "$@"

