const core = require('../../lib/application.js');

const CATEGORY_COLORS = ['#b85c45', '#d99768', '#d8b36a', '#879b75', '#738c92', '#8d7895'];

function drawPolyline(page, canvasId, series, options = {}) {
  page.createSelectorQuery().select(`#${canvasId}`).boundingClientRect((rect) => {
    if (!rect || !series.length) return;
    const context = wx.createCanvasContext(canvasId, page);
    const left = 18;
    const right = rect.width - 12;
    const top = 12;
    const bottom = rect.height - 20;
    const width = right - left;
    const height = bottom - top;
    const zeroY = top + (options.zeroRatio ?? 0.5) * height;
    context.setStrokeStyle('#e4d9ce');
    context.setLineWidth(1);
    context.beginPath();
    context.moveTo(left, zeroY);
    context.lineTo(right, zeroY);
    context.stroke();
    for (const line of options.lines || [{ ratioKey: 'yRatio', color: '#b85c45' }]) {
      context.setStrokeStyle(line.color);
      context.setFillStyle(line.color);
      context.setLineWidth(2);
      context.beginPath();
      series.forEach((point, index) => {
        const x = left + point.xRatio * width;
        const y = top + point[line.ratioKey] * height;
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      context.stroke();
      series.forEach((point) => {
        context.beginPath();
        context.arc(left + point.xRatio * width, top + point[line.ratioKey] * height, 2.5, 0, Math.PI * 2);
        context.fill();
      });
    }
    context.draw();
  }).exec();
}

function drawCategoryPie(page, items) {
  page.createSelectorQuery().select('#categoryChart').boundingClientRect((rect) => {
    if (!rect || !items.length) return;
    const context = wx.createCanvasContext('categoryChart', page);
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const radius = Math.min(rect.width, rect.height) * 0.34;
    items.forEach((item, index) => {
      context.setFillStyle(CATEGORY_COLORS[index % CATEGORY_COLORS.length]);
      context.beginPath();
      context.moveTo(centerX, centerY);
      context.arc(
        centerX,
        centerY,
        radius,
        -Math.PI / 2 + item.startRatio * Math.PI * 2,
        -Math.PI / 2 + item.endRatio * Math.PI * 2,
      );
      context.closePath();
      context.fill();
    });
    context.setFillStyle('#fffdfa');
    context.beginPath();
    context.arc(centerX, centerY, radius * 0.52, 0, Math.PI * 2);
    context.fill();
    context.draw();
  }).exec();
}

function touchPoint(event) {
  const point = event?.changedTouches?.[0] || event?.touches?.[0];
  if (!point) return null;
  return { x: point.pageX ?? point.clientX ?? point.x, y: point.pageY ?? point.clientY ?? point.y };
}

Page({
  data: {
    scope: 'controlled',
    status: 'active',
    model: null,
    flows: [],
    error: '',
    openLogicalTransactionId: '',
    rowGesture: null,
    swipeAxis: null,
  },

  onShow() {
    this.refresh();
  },

  refresh() {
    const app = getApp();
    if (!app.globalData.state) {
      wx.switchTab({ url: '/pages/settings/settings' });
      return;
    }
    const model = core.getBillAnalysisModel(app.globalData.state, {
      today: core.todayIso(),
      scope: this.data.scope,
    });
    model.categories.items = model.categories.items.map((item, index) => ({
      ...item,
      color: CATEGORY_COLORS[index % CATEGORY_COLORS.length],
    }));
    const flows = core.listRecentTransactions(app.globalData.state, { status: this.data.status });
    this.setData({
      model,
      flows,
      error: app.globalData.storageError || '',
    }, () => this.drawCharts());
  },

  onScopeTap(event) {
    const scope = event.currentTarget.dataset.scope;
    if (scope === this.data.scope) return;
    this.setData({ scope }, () => this.refresh());
  },

  onStatusTap(event) {
    const status = event.currentTarget.dataset.status;
    if (!['active', 'revoked'].includes(status) || status === this.data.status) return;
    this.setData({ status }, () => this.refresh());
  },

  closeSwipeRows() {
    if (this.data.openLogicalTransactionId) this.setData({ openLogicalTransactionId: '', swipeAxis: null });
  },

  onPageScroll() {
    this.closeSwipeRows();
  },

  onRowTouchStart(event) {
    const point = touchPoint(event);
    if (!point) return;
    const logicalTransactionId = event.currentTarget.dataset.id;
    if (this.data.openLogicalTransactionId && this.data.openLogicalTransactionId !== logicalTransactionId) this.closeSwipeRows();
    this.setData({ rowGesture: { logicalTransactionId, startX: point.x, startY: point.y, axis: null }, swipeAxis: null });
  },

  onRowTouchMove(event) {
    const gesture = this.data.rowGesture;
    const point = touchPoint(event);
    if (!gesture || !point) return;
    const deltaX = point.x - gesture.startX;
    const deltaY = point.y - gesture.startY;
    if (!gesture.axis && Math.max(Math.abs(deltaX), Math.abs(deltaY)) >= 8) {
      gesture.axis = Math.abs(deltaX) > Math.abs(deltaY) ? 'x' : 'y';
      this.setData({ rowGesture: gesture, swipeAxis: gesture.axis });
    }
  },

  onRowTouchEnd(event) {
    const gesture = this.data.rowGesture;
    const point = touchPoint(event);
    this.setData({ rowGesture: null, swipeAxis: null });
    if (!gesture || !point) return;
    const deltaX = point.x - gesture.startX;
    const deltaY = point.y - gesture.startY;
    if (gesture.axis !== 'x' || Math.abs(deltaX) < Math.abs(deltaY)) {
      if (gesture.axis === 'y') this.closeSwipeRows();
      return;
    }
    if (deltaX < -48) this.setData({ openLogicalTransactionId: gesture.logicalTransactionId });
    else if (deltaX > 48) this.closeSwipeRows();
  },

  onRowTouchCancel() {
    this.setData({ rowGesture: null, swipeAxis: null });
  },

  openTransaction(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    this.closeSwipeRows();
    const app = getApp();
    app.globalData.transactionReturn = { page: 'bills', scrollTop: 0 };
    wx.navigateTo({ url: `/pages/transaction-detail/transaction-detail?id=${encodeURIComponent(id)}&mode=view` });
  },

  openTransactionAction(event) {
    const id = event.currentTarget.dataset.id;
    const mode = event.currentTarget.dataset.mode;
    if (!id || !mode) return;
    this.closeSwipeRows();
    const app = getApp();
    app.globalData.transactionReturn = { page: 'bills', scrollTop: 0 };
    wx.navigateTo({ url: `/pages/transaction-detail/transaction-detail?id=${encodeURIComponent(id)}&mode=${mode}` });
  },

  drawCharts() {
    const model = this.data.model;
    if (!model) return;
    drawPolyline(this, 'dailyChart', model.daily.points, { zeroRatio: model.daily.zeroRatio });
    drawCategoryPie(this, model.categories.items);
    drawPolyline(this, 'trendChart', model.trend.periods, {
      zeroRatio: model.trend.zeroRatio,
      lines: [
        { ratioKey: 'budgetYRatio', color: '#b85c45' },
        { ratioKey: 'spendYRatio', color: '#738c92' },
      ],
    });
  },
});
