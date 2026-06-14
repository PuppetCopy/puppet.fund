(function () {
  if (!('serviceWorker' in navigator)) return

  var SCOPE = '/'
  var PROD_SW = '/service-worker.js'
  var DEV_SW = '/dev-sw.js?dev-sw'

  var hadController = !!navigator.serviceWorker.controller
  var reloading = false

  navigator.serviceWorker.addEventListener('controllerchange', function () {
    if (reloading) return
    if (!hadController) {
      hadController = true
      return
    }
    reloading = true
    window.location.reload()
  })

  function promote(worker) {
    if (worker) worker.postMessage({ type: 'SKIP_WAITING' })
  }

  function publishUpdate(worker) {
    var apply = function () {
      promote(worker)
    }
    window.__pwaUpdate = { available: true, apply: apply }
    window.dispatchEvent(new CustomEvent('pwa:update-available', { detail: { apply: apply } }))
  }

  function watch(registration) {
    if (registration.waiting && navigator.serviceWorker.controller) {
      promote(registration.waiting)
    }

    registration.addEventListener('updatefound', function () {
      var installing = registration.installing
      if (!installing) return
      installing.addEventListener('statechange', function () {
        if (installing.state !== 'installed') return
        if (!navigator.serviceWorker.controller) return
        publishUpdate(registration.waiting || installing)
      })
    })

    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') {
        registration.update().catch(function () {})
      }
    })
  }

  fetch(PROD_SW, { method: 'HEAD' })
    .then(function (res) {
      var isScript = (res.headers.get('content-type') || '').indexOf('javascript') !== -1
      return isScript
        ? navigator.serviceWorker.register(PROD_SW, { scope: SCOPE })
        : navigator.serviceWorker.register(DEV_SW, { scope: SCOPE, type: 'module' })
    })
    .then(watch)
    .catch(function () {})
})()
