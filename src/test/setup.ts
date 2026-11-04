import '@testing-library/jest-dom/vitest'
import { cleanup, configure } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(() => cleanup())

// Pages load their data lazily; under a full parallel run one second is sometimes not enough.
configure({ asyncUtilTimeout: 5000 })

// jsdom has HTMLDialogElement but not its modal methods; this is enough for tests to open and close one.
if (typeof HTMLDialogElement.prototype.showModal !== 'function') {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute('open')
    this.dispatchEvent(new Event('close'))
  }
}

// The router's ScrollRestoration scrolls on every navigation; jsdom only logs "not implemented".
window.scrollTo = () => {}
