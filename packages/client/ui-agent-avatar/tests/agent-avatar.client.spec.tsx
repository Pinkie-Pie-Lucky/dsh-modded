// @vitest-environment jsdom

import { afterEach, describe, expect, it, onTestFinished } from 'vitest'
import { cleanup } from '@testing-library/react'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import type { AssistantBeforeOwnerProps } from '@deepseek-ai/dsh-client-ui-chat/client'
import { AGENT_NAME } from '../src/client/AgentIdentityName.tsx'
import { apply, inject } from '../src/client/index.ts'
import { apply as hostApply } from '../src/index.ts'

afterEach(cleanup)

const REPLY_SEAT = 'conversation.chat.assistant.before'
const MARK_SEAT = 'sidebar.brand.mark'
const NAME_SEAT = 'sidebar.brand.name'

/**
 * The packaged artwork's URL in the app: the client build emits the file under
 * `lib/assets/` with its content revision, and the asset route serves it. Vite
 * inlines the same small SVG as a data URI while the unit test runs.
 */
const ARTWORK_SRC = /^plugins\/@deepseek-ai\/dsh-client-ui-agent-avatar\/assets\/avatar-[0-9a-f]{12}\.svg$/u

function namesArtwork(image: Element | null | undefined): boolean {
  const src = image?.getAttribute('src') ?? ''
  return src.startsWith('data:image/svg+xml') || ARTWORK_SRC.test(src)
}

/** Mount the plugin beside all three declared identity seats. */
async function bench() {
  const runtime = await SlotTestRuntime.create()
  onTestFinished(() => runtime.dispose())
  await runtime.sessions.add({ id: 'agent-avatar' })
  const session = runtime.sessions.retainFor(runtime.ctx, SessionId('agent-avatar'))
  await runtime.declare({
    [REPLY_SEAT]: { kind: 'single', scope: 'session' },
    [MARK_SEAT]: { kind: 'single', scope: 'root' },
    [NAME_SEAT]: { kind: 'single', scope: 'root' },
  })
  const fiber = runtime.ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return {
    fiber,
    reply: (owner: AssistantBeforeOwnerProps) => runtime.renderSlot(REPLY_SEAT, owner, { session }),
    mark: () => runtime.renderSlot(MARK_SEAT, { size: 24 }),
    name: () => runtime.renderSlot(NAME_SEAT, {}),
  }
}

describe('agent identity plugin', () => {
  it('keeps the host Loader entry inert and declares only the slot service', () => {
    expect(hostApply).not.toThrow()
    expect(inject).toEqual(['slots'])
  })

  it('renders the packaged avatar on a reply fragment', async () => {
    const subject = await bench()
    const image = subject.reply({ step: 0, final: true, groupPart: 'response' }).container.querySelector('img')
    expect(namesArtwork(image)).toBe(true)
    expect(image?.getAttribute('alt')).toBe('')
    expect(image?.getAttribute('draggable')).toBe('false')
  })

  it('marks a whole-step reply that carries no process split', async () => {
    const subject = await bench()
    expect(subject.reply({ step: 2, final: true }).container.querySelector('img')).not.toBeNull()
  })

  it('leaves a folded Turn process fragment unmarked', async () => {
    const subject = await bench()
    expect(subject.reply({ step: 1, final: false, groupPart: 'reasoning' }).container.querySelector('img')).toBeNull()
  })

  it('stamps the sidebar brand row with the same artwork at the requested size', async () => {
    const subject = await bench()
    const image = subject.mark().container.querySelector('img')
    expect(namesArtwork(image)).toBe(true)
    expect(image?.getAttribute('width')).toBe('24')
    expect(image?.getAttribute('height')).toBe('24')
    expect(image?.getAttribute('aria-hidden')).toBe('true')
  })

  it('signs the sidebar brand row with the chosen name', async () => {
    const subject = await bench()
    expect(subject.name().view.getByText(AGENT_NAME)).toBeTruthy()
    expect(AGENT_NAME).toBe('阿墨')
  })

  it('withdraws every seat when the plugin unloads', async () => {
    const subject = await bench()
    const reply = subject.reply({ step: 0, final: true })
    const mark = subject.mark()
    const name = subject.name()
    expect(reply.container.querySelector('img')).not.toBeNull()
    expect(mark.container.querySelector('img')).not.toBeNull()
    expect(name.view.getByText(AGENT_NAME)).toBeTruthy()

    await subject.fiber.dispose()

    reply.update({ step: 0, final: true })
    mark.update({ size: 24 })
    expect(reply.container.querySelector('img')).toBeNull()
    expect(mark.container.querySelector('img')).toBeNull()
  })
})
