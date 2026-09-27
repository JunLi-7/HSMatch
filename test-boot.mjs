import { pathToFileURL } from 'node:url'
const url = pathToFileURL('E:\\星火\\赛事系统\\server\\index.js').href
import(url)
  .then(() => {
    console.log('BOOT_OK')
    process.exit(0)
  })
  .catch((e) => {
    console.error('BOOT_ERR', e && e.stack ? e.stack : e)
    process.exit(1)
  })
