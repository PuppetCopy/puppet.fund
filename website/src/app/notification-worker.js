const HOLDER_WAIT_MS = 1500

self.addEventListener('notificationclick', event => {
  event.notification.close()
  const prompt = event.notification.data
  const deciding = event.action === 'approve' || event.action === 'decline'
  const walletUrl = new URL('wallet', self.registration.scope)
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async list => {
      const holder =
        prompt === null || prompt === undefined
          ? null
          : await new Promise(resolve => {
              const timer = setTimeout(() => resolve(null), HOLDER_WAIT_MS)
              for (const client of list) {
                const channel = new MessageChannel()
                channel.port1.onmessage = message => {
                  clearTimeout(timer)
                  resolve({ client, where: message.data })
                }
                client.postMessage({ type: deciding ? 'sign-decision' : 'sign-focus', page: prompt.page, id: prompt.id, approved: event.action === 'approve' }, [channel.port2])
              }
            })
      if (holder !== null && holder.where === 'wallet' && !deciding) {
        const wallet = list.find(c => new URL(c.url).pathname === walletUrl.pathname)
        if (wallet !== undefined) {
          await wallet.focus()
          return
        }
        await self.clients.openWindow(walletUrl.href)
        return
      }
      if (holder !== null) {
        await holder.client.focus()
        return
      }
      const open = list.find(c => c.url.startsWith(self.registration.scope))
      if (open !== undefined) {
        await open.focus()
        return
      }
      await self.clients.openWindow(walletUrl.href)
    })
  )
})
