import {type Activity, type ReservationApi, type Row} from './api';
const BUTTON = 'seu-lecture-helper-button';
interface VueNode {$props?: {item?: Row}; $parent?: VueNode}
export function componentId(card: Element): string | undefined {
  let vm = (card as Element & {__vue__?: VueNode}).__vue__;
  for (let i = 0; vm && i < 8; i++, vm = vm.$parent) {
    const item = vm.$props?.item;
    if (item?.WID) return String(item.WID);
  }
}
export function matchCard(card: Element, items: Activity[]): string | undefined {
  const direct = componentId(card);
  if (direct) return direct;
  const title = card.querySelector('.activity-name [title]')?.getAttribute('title');
  const details = card.querySelectorAll('.activity-text');
  const place = details[details.length - 1]?.textContent?.trim();
  const times = details[1]?.querySelector('[title]')?.getAttribute('title')?.replace(/\D/g, '');
  const matches = items.filter(x => x.title === title && x.place === place && (x.eventStart + x.eventEnd).replace(/\D/g, '') === times);
  return matches.length === 1 ? matches[0].id : undefined;
}
export function visible(element: Element) {
  for (let e: Element | null = element; e; e = e.parentElement) {
    if (e.hasAttribute('hidden') || e.getAttribute('aria-hidden') === 'true') return false;
    const style = getComputedStyle(e);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
  }
  return true;
}
export class Mount {
  private items: Activity[] = [];
  private reservationUpdates = new Map<string, boolean>();
  private active?: {ids: string[]; label: string};
  private observer?: MutationObserver;
  private timer?: ReturnType<typeof setTimeout>;
  private epoch = 0;
  private stopped = false;
  constructor(private api: Pick<ReservationApi, 'list'>, private open: (id: string) => void) {}
  private route = () => {
    this.remove(); this.items = []; void this.load();
  };
  private remove() {document.querySelectorAll('.' + BUTTON).forEach(x => x.remove());}
  start() {
    this.stopped = false;
    this.observer = new MutationObserver(() => {
      clearTimeout(this.timer); this.timer = setTimeout(() => this.scan(), 50);
    });
    this.observer.observe(document.body, {childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class', 'hidden']});
    window.addEventListener('hashchange', this.route); void this.load();
  }
  private async load() {
    const epoch = ++this.epoch;
    // Fresh list snapshots supersede older local status; later verified updates
    // still win over a list request that was already in flight.
    this.reservationUpdates.clear();
    this.scan();
    if (!/^#\/(hdyy|hdxq)(?:\?|$)/.test(location.hash)) return;
    try {
      const data = await this.api.list();
      if (!this.stopped && epoch === this.epoch) {this.items = data.activities; this.scan();}
    } catch {
      // A Vue/route ID still allows a button; opening it retries activity loading.
      if (!this.stopped && epoch === this.epoch) this.scan();
    }
  }
  setReserved(id: string, reserved: boolean) {
    if (this.reservationUpdates.get(id) === reserved) return;
    this.reservationUpdates.set(id, reserved); this.scan();
  }
  setActive(ids: string[] = [], label = '') {
    if (this.active?.label === label && this.active.ids.length === ids.length && this.active.ids.every((id, i) => id === ids[i])) return;
    if (!this.active && (!ids.length || !label)) return;
    this.active = ids.length && label ? {ids, label} : undefined; this.scan();
  }
  scan() {
    if (this.stopped) return;
    const targets: {parent: Element; id: string}[] = [];
    const route = location.hash.split('?')[0];
    if (route === '#/hdyy') {
      const selected = document.querySelector('.hdyy .mint-navbar .is-selected');
      if (!selected || selected.textContent?.trim() === '活动列表') {
        document.querySelectorAll('.activity-container').forEach(card => {
          if (!visible(card)) return;
          const id = matchCard(card, this.items);
          const parent = card.querySelector('.activity-content .ydd-inline-flex.ydd-pull-right.ydd-pt-14');
          if (id && parent) targets.push({parent, id});
        });
      }
    } else if (route === '#/hdxq') {
      const id = new URLSearchParams(location.hash.split('?')[1] ?? '').get('WID');
      const parent = [...document.querySelectorAll('.hdxq-foot')].find(visible);
      if (id && parent) targets.push({parent, id});
    }
    const parents = new Set(targets.map(x => x.parent));
    document.querySelectorAll('.' + BUTTON).forEach(button => {if (!button.parentElement || !parents.has(button.parentElement)) button.remove();});
    for (const {parent, id} of targets) {
      let button = parent.querySelector<HTMLButtonElement>('.' + BUTTON);
      if (button?.dataset.activityId !== id) {
        button?.remove(); button = document.createElement('button');
        button.type = 'button'; button.className = BUTTON; button.dataset.activityId = id;
        button.addEventListener('click', event => {event.preventDefault(); event.stopPropagation(); this.open(id);});
        parent.append(button);
      }
      const reserved = this.reservationUpdates.get(id) ?? this.items.find(item => item.id === id)?.reserved ?? false;
      const label = reserved ? '已预约' : this.active?.ids.includes(id) ? this.active.label : '预约助手';
      if (button!.textContent !== label) button!.textContent = label;
      button!.dataset.reserved = String(reserved);
      button!.title = reserved ? '已确认预约；点击可重新查询当前状态' : '打开预约助手';
      const native = [...parent.querySelectorAll<HTMLButtonElement>('button')].find(x => x !== button && visible(x));
      const sizeClass = native && [...native.classList].find(x => /^ydd-button-(small|large|min)$/.test(x));
      const className = BUTTON + (sizeClass ? ' ' + sizeClass : '');
      if (button!.className !== className) button!.className = className;
      const style = document.createElement('button').style;
      style.cssText = 'margin-left:10px;box-sizing:border-box;border:1px solid #287547;background:#f0f8f2;color:#24663b;cursor:pointer;white-space:nowrap;flex-shrink:0';
      if (native) {
        const computed = getComputedStyle(native);
        for (const property of ['font-family','font-size','font-weight','line-height','padding-top','padding-right','padding-bottom','padding-left','border-radius','border-width']) style.setProperty(property, computed.getPropertyValue(property));
        const bounds = native.getBoundingClientRect();
        if (bounds.height) style.height = `${bounds.height}px`;
        // Four-character buttons use the same visual footprint as their school counterpart.
        if (bounds.width && native.textContent?.trim().length === 4) style.width = `${bounds.width}px`;
      } else {style.padding = '5px 12px'; style.borderRadius = '18px'; style.fontSize = '14px';}
      if (button!.style.cssText !== style.cssText) button!.style.cssText = style.cssText;
    }
  }
  stop() {this.stopped = true; ++this.epoch; this.observer?.disconnect(); clearTimeout(this.timer); window.removeEventListener('hashchange', this.route); this.remove();}
}
