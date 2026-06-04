import { createRouter, createWebHashHistory } from 'vue-router'

function normalizeInitialHashRoute(): void {
  if (typeof window === 'undefined') return

  const { pathname, search, hash } = window.location
  const isKnownCleanRoute = pathname === '/skills'
    || pathname === '/workbench'
    || pathname === '/github-trending'
    || pathname === '/diagnostics'
    || pathname.startsWith('/thread/')
  if (!isKnownCleanRoute) return
  if (hash && hash !== '#/') return

  window.history.replaceState(window.history.state, '', `/#${pathname}${search}`)
}

normalizeInitialHashRoute()

const EmptyRouteView = {
  render: () => null,
}

const router = createRouter({
  history: createWebHashHistory('/'),
  routes: [
    {
      path: '/',
      name: 'home',
      component: EmptyRouteView,
    },
    {
      path: '/thread/:threadId',
      name: 'thread',
      component: EmptyRouteView,
    },
    {
      path: '/skills',
      name: 'skills',
      component: EmptyRouteView,
    },
    {
      path: '/workbench',
      name: 'workbench',
      component: EmptyRouteView,
    },
    {
      path: '/github-trending',
      name: 'github-trending',
      component: EmptyRouteView,
    },
    {
      path: '/diagnostics',
      name: 'diagnostics',
      component: EmptyRouteView,
    },
    {
      path: '/new-thread',
      redirect: { name: 'home' },
    },
    { path: '/:pathMatch(.*)*', redirect: { name: 'home' } },
  ],
})

export default router
