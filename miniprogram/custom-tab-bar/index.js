const TAB_ITEMS = [
  { key: 'home', label: '账本', path: '/pages/home/home', icon: 'ledger' },
  { key: 'settings', label: '我的', path: '/pages/settings/settings', icon: 'profile' },
];

const HOME_PATH = '/pages/home/home';
const ENTRY_PATH = '/pages/entry/entry';

function currentPagePath() {
  const pages = getCurrentPages();
  const current = pages[pages.length - 1];
  return current?.route ? `/${current.route.replace(/^\//, '')}` : '';
}

Component({
  data: {
    items: TAB_ITEMS,
    selected: 'home',
  },

  lifetimes: {
    attached() {
      this.syncSelected();
    },
  },

  pageLifetimes: {
    show() {
      this.syncSelected();
    },
  },

  methods: {
    syncSelected() {
      const path = currentPagePath();
      const active = this.data.items.find((item) => item.path === path);
      const selected = active ? active.key : '';
      if (selected !== this.data.selected) this.setData({ selected });
    },

    onTabTap(event) {
      const item = this.data.items[Number(event.currentTarget.dataset.index)];
      if (!item) return;
      // Do not optimistically change selected: the current route is the source of truth.
      this.syncSelected();
      wx.switchTab({ url: item.path });
    },

    onEntryTap() {
      if (currentPagePath() === HOME_PATH) {
        wx.navigateTo({ url: ENTRY_PATH });
        return;
      }
      wx.switchTab({
        url: HOME_PATH,
        success: () => wx.navigateTo({ url: ENTRY_PATH }),
      });
    },
  },
});

if (typeof module !== 'undefined' && module.exports) {
  module.exports.TAB_ITEMS = TAB_ITEMS;
  module.exports.currentPagePath = currentPagePath;
}
