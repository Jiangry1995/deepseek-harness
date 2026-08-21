// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import type {
  SidebarFooterActionOwnerProps, SidebarRootComponentProps, SidebarSectionOwnerProps,
  SidebarSettingsOwnerProps,
} from '../src/client/contract/slots.ts'
import { SidebarRoot } from '../src/client/SidebarRoot.tsx'
import { en } from '../src/client/locales.ts'

// English-dictionary translate stub: the shell renders the same copy the
// assertions below query by accessible name.
const t: SidebarRootComponentProps['t'] = key => (en as Record<string, string>)[key] ?? key

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

// The shell never reads the global hooks itself, but they ride the standard
// props share; stub them as never-called functions.
const neverHook = (() => { throw new Error('shell must not read global hooks') }) as never

function mountShell({ collapsed = false, width = 300 }: { collapsed?: boolean; width?: number } = {}) {
  const startSession = vi.fn()
  const toggleSidebar = vi.fn()
  let regionOwner: SidebarSectionOwnerProps | undefined
  let settingsOwner: SidebarSettingsOwnerProps | undefined
  let footerActionOwner: SidebarFooterActionOwnerProps | undefined
  const brandMark = <span data-testid="custom-brand-mark">M</span>
  const brandName = <span data-testid="custom-brand-name">Custom Brand</span>
  let current = { collapsed, width }
  const root = () => (
    <SidebarRoot
      collapsed={current.collapsed} width={current.width}
      useSessions={neverHook} useWorkspaces={neverHook}
      startSession={startSession} toggleSidebar={toggleSidebar} t={t}
      renderSlot={((
        key: string,
        owner: SidebarFooterActionOwnerProps | SidebarSectionOwnerProps | SidebarSettingsOwnerProps,
      ) => {
        if (key === 'sidebar.brand.mark') return brandMark
        if (key === 'sidebar.brand.name') return brandName
        if (key === 'sidebar.settings') {
          settingsOwner = owner
          return <div data-testid="settings-seat" data-wide={owner.wide} />
        }
        if (key === 'sidebar.footer.action') {
          footerActionOwner = owner
          return <div data-testid="footer-action-seat" data-wide={owner.wide} />
        }
        regionOwner = owner as SidebarSectionOwnerProps
        return <div data-testid="region" data-wide={owner.wide} />
      }) as SidebarRootComponentProps['renderSlot']}
    />
  )
  const view = render(root())
  return {
    startSession,
    toggleSidebar,
    regionOwner: () => {
      if (regionOwner === undefined) throw new Error('region owner not rendered')
      return regionOwner
    },
    settingsOwner: () => {
      if (settingsOwner === undefined) throw new Error('settings owner not rendered')
      return settingsOwner
    },
    footerActionOwner: () => {
      if (footerActionOwner === undefined) throw new Error('footer action owner not rendered')
      return footerActionOwner
    },
    rerender(next: Partial<typeof current>) {
      current = { ...current, ...next }
      view.rerender(root())
    },
  }
}

describe('SidebarRoot shell', () => {
  it('routes New Session (capsule + wordmark) and the column toggle', () => {
    const b = mountShell()
    expect(screen.getByTestId('custom-brand-mark')).toBeTruthy()
    expect(screen.getByTestId('custom-brand-name')).toBeTruthy()
    // Expanded, both the wordmark and the capsule start a session.
    const starters = screen.getAllByRole('button', { name: 'New session' })
    expect(starters).toHaveLength(2)
    for (const button of starters) fireEvent.click(button)
    expect(b.startSession).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }))
    expect(b.toggleSidebar).toHaveBeenCalledOnce()
  })

  it('renders generic brand fallbacks when no package fills the slots', () => {
    vi.stubEnv('DSH_CLIENT_COMMIT_HASH', '0123456')
    const { container } = render(<SidebarRoot
      collapsed={false} width={300}
      useSessions={neverHook} useWorkspaces={neverHook}
      startSession={vi.fn()} toggleSidebar={vi.fn()} t={t}
      renderSlot={((_key: string, _owner: unknown, options?: { fallback?: ReactNode }) =>
        options?.fallback ?? null) as SidebarRootComponentProps['renderSlot']}
    />)

    expect(screen.getByText('DSH Local Build')).toBeTruthy()
    expect(screen.getByText('0123456')).toBeTruthy()
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('hands the region its wide flag and clamps expandSidebar to the collapsed state', () => {
    const b = mountShell()
    expect(b.regionOwner().wide).toBe(true)
    // The settings seat rides the same wide flag (ui-settings renders the row).
    expect(b.settingsOwner().wide).toBe(true)
    expect(b.footerActionOwner().wide).toBe(true)
    // Expanded: the request is a no-op (no accidental collapse).
    b.regionOwner().expandSidebar()
    expect(b.toggleSidebar).not.toHaveBeenCalled()
  })

  it('keeps the region mounted through collapse and expands on its request', () => {
    vi.useFakeTimers()
    const b = mountShell()
    b.rerender({ collapsed: true })
    // Wide content survives the crossfade window, then settles into the rail.
    expect(b.regionOwner().wide).toBe(true)
    vi.advanceTimersByTime(200)
    b.rerender({})
    expect(b.regionOwner().wide).toBe(false)
    expect(b.footerActionOwner().wide).toBe(false)
    expect(screen.getByTestId('region')).toBeTruthy()
    b.regionOwner().expandSidebar()
    expect(b.toggleSidebar).toHaveBeenCalledOnce()
  })

  it('renders statically collapsed on a cold start (no crossfade classes)', () => {
    const b = mountShell({ collapsed: true })
    expect(b.regionOwner().wide).toBe(false)
    expect(screen.getByRole('button', { name: 'Open sidebar' })).toBeTruthy()
  })
})

describe('SidebarRoot side-panel shell', () => {
  function sessionsHook(current: string | undefined = 's-1') {
    return ((sel: (s: { current: string | undefined }) => unknown) => sel({ current })) as SidebarRootComponentProps['useSessions']
  }

  function mountSidePanel(options: { useSessions?: SidebarRootComponentProps['useSessions'] } = {}) {
    const startSession = vi.fn()
    const toggleSidebar = vi.fn()
    const useSessions = options.useSessions ?? sessionsHook()
    const view = render(
      <SidebarRoot
        collapsed={false}
        width={0}
        surface="side-panel"
        useSessions={useSessions}
        useWorkspaces={neverHook}
        startSession={startSession}
        toggleSidebar={toggleSidebar}
        t={t}
        renderSlot={((
          key: string,
          owner: SidebarFooterActionOwnerProps | SidebarSectionOwnerProps | SidebarSettingsOwnerProps,
        ) => {
          if (key === 'sidebar.settings') {
            return <button type="button" data-testid="settings-seat" data-wide={String(owner.wide)}>Settings</button>
          }
          if (key === 'sidebar.footer.action') {
            return <div data-testid="footer-action-seat" data-wide={String(owner.wide)} />
          }
          return <div data-testid="region" data-wide={String(owner.wide)} />
        }) as SidebarRootComponentProps['renderSlot']}
      />,
    )
    return { startSession, toggleSidebar, ...view }
  }

  it('renders chrome actions and hides the desktop rail', () => {
    mountSidePanel()
    expect(screen.getByRole('button', { name: 'Chats and workspaces' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'New session' })).toBeTruthy()
    expect(screen.getByTestId('settings-seat').getAttribute('data-wide')).toBe('false')
    expect(screen.queryByRole('button', { name: 'Open sidebar' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Collapse sidebar' })).toBeNull()
    expect(screen.queryByRole('navigation', { name: 'Chats and workspaces' })).toBeNull()
  })

  it('packs new-session and settings in one end cluster', () => {
    const view = mountSidePanel()
    const cluster = view.container.querySelector('[data-chrome-end]')
    expect(cluster).toBeTruthy()
    expect(cluster?.contains(screen.getByRole('button', { name: 'New session' }))).toBe(true)
    expect(cluster?.contains(screen.getByTestId('settings-seat'))).toBe(true)
  })

  it('opens the history drawer with a wide workspace browser', () => {
    mountSidePanel()
    fireEvent.click(screen.getByRole('button', { name: 'Chats and workspaces' }))
    expect(screen.getByRole('navigation', { name: 'Chats and workspaces' })).toBeTruthy()
    expect(screen.getByTestId('region').getAttribute('data-wide')).toBe('true')
    expect(screen.getByRole('button', { name: 'Close' }).getAttribute('aria-expanded')).toBe('true')
  })

  it('starts a session from chrome and closes the drawer', () => {
    const b = mountSidePanel()
    fireEvent.click(screen.getByRole('button', { name: 'Chats and workspaces' }))
    fireEvent.click(screen.getByRole('button', { name: 'New session' }))
    expect(b.startSession).toHaveBeenCalledOnce()
    expect(screen.queryByRole('navigation', { name: 'Chats and workspaces' })).toBeNull()
  })

  it('closes the drawer when the current session changes', () => {
    let current: string | undefined = 's-1'
    const useSessions = ((sel: (s: { current: string | undefined }) => unknown) => sel({ current })) as SidebarRootComponentProps['useSessions']
    const view = mountSidePanel({ useSessions })
    fireEvent.click(screen.getByRole('button', { name: 'Chats and workspaces' }))
    expect(screen.getByRole('navigation', { name: 'Chats and workspaces' })).toBeTruthy()
    current = 's-2'
    view.rerender(
      <SidebarRoot
        collapsed={false}
        width={0}
        surface="side-panel"
        useSessions={useSessions}
        useWorkspaces={neverHook}
        startSession={view.startSession}
        toggleSidebar={view.toggleSidebar}
        t={t}
        renderSlot={((
          key: string,
        ) => {
          if (key === 'sidebar.settings') return <button type="button">Settings</button>
          if (key === 'sidebar.footer.action') return <div />
          return <div data-testid="region" />
        }) as SidebarRootComponentProps['renderSlot']}
      />,
    )
    expect(screen.queryByRole('navigation', { name: 'Chats and workspaces' })).toBeNull()
  })
})
