// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { AssistantBeforeOwnerProps } from '../src/client/contract/slots.ts'
import { AssistantMarkdown, type AssistantMarkdownProps } from '../src/client/chat/AssistantMarkdown.tsx'
import { useDisclosure } from '../src/client/chat/use-disclosure.ts'
import { useSearchableHidden } from '../src/client/chat/searchable-hidden.ts'
import { zh } from '../src/client/locale.ts'
import { unusedImageLoader } from './reasoning-component-fixture.tsx'
import { useDetailedPresentation } from './presentation-fixture.client.ts'

afterEach(cleanup)

const t = makeTranslate(zh, commonZh)

const base = {
  blocks: [{ kind: 'text', text: 'reply body' }],
  streaming: false,
  loadImage: unusedImageLoader,
  useDisclosure,
  useGroupAction: useSearchableHidden,
  usePresentation: useDetailedPresentation,
  t,
} satisfies Omit<AssistantMarkdownProps, 'renderSlot'>

const MARK: AssistantBeforeOwnerProps = { step: 0, final: true, groupPart: 'response' }

/** Render one reply with a stub seat that answers only the leading-mark key. */
function renderReply(mark: AssistantBeforeOwnerProps | undefined, occupant: React.ReactNode) {
  const renderSlot = vi.fn((
    key: 'conversation.chat.reasoning.body' | 'conversation.chat.message.images' | 'conversation.chat.assistant.before',
    _owner: object,
    _opts?: { fallback?: React.ReactNode },
  ) => {
    // These replies carry no reasoning or image block, so only the mark seat is asked for.
    if (key !== 'conversation.chat.assistant.before') throw new Error(`Unexpected reply Slot: ${key}`)
    return occupant
  })
  const view = render(<AssistantMarkdown {...base} {...mark === undefined ? {} : { mark }} renderSlot={renderSlot} />)
  return { view, renderSlot }
}

describe('assistant reply leading mark', () => {
  it('keeps the full-width reply and asks for no mark when the caller supplies no seat owner', () => {
    const { view, renderSlot } = renderReply(undefined, <span data-testid="mark" />)
    expect(renderSlot).not.toHaveBeenCalledWith('conversation.chat.assistant.before', expect.anything(), expect.anything())
    expect(view.container.querySelector('[data-assistant-mark]')).toBeNull()
    expect(view.getByText('reply body')).toBeTruthy()
  })

  it('renders one mark before the body and hands it the reply fragment it decorates', () => {
    const { view, renderSlot } = renderReply(MARK, <span data-testid="mark" />)
    expect(renderSlot).toHaveBeenCalledWith('conversation.chat.assistant.before', MARK, { fallback: null })
    const mark = view.getByTestId('mark')
    const body = view.getByText('reply body')
    expect(view.container.querySelector('[data-assistant-mark]')).not.toBeNull()
    // The mark's own wrapper precedes the body in document order.
    expect(mark.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
    expect(view.container.querySelector('[data-assistant-mark]')?.getAttribute('data-streaming')).toBeNull()
  })

  it('reserves no gutter while the seat renders nothing', () => {
    const { view } = renderReply(MARK, null)
    expect(view.container.querySelector('[data-assistant-mark]')).toBeNull()
    expect(view.getByText('reply body')).toBeTruthy()
    // With no mark the root holds the body alone, so the reply keeps its column.
    expect(view.container.firstElementChild?.children).toHaveLength(1)
  })
})
