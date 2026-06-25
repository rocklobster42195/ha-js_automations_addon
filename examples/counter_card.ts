/**
 * @name Counter Card
 * @icon mdi:counter
 * @description Script Pack example: registers a counter entity and installs a Lovelace card
 *              with +/− buttons. The minus button is hidden when the value is zero.
 * @label Example
 * @card
 */

const ENTITY_ID = `number.${ha.getHeader('filename', 'counter_card.ts').split('.')[0]}`;

// Persistent counter value — survives script restarts
const counter = ha.persistent<number>('counter_card_value', 0);

ha.register(ENTITY_ID, {
    name: 'Counter',
    icon: 'mdi:counter',
    step: 1,
    mode: 'box',
    initial_state: counter.value,
});

// Keep persistent value in sync when the entity is changed via HA UI
ha.on(ENTITY_ID, ({ state }) => {
    const val = parseInt(state, 10);
    if (isNaN(val) || val === counter.value) return;
    counter.value = val;
});

// Actions called from the Lovelace card buttons
ha.action('increase', () => {
    counter.value++;
    ha.update(ENTITY_ID, counter.value);
});

ha.action('decrease', () => {
    if (counter.value <= 0) return;
    counter.value--;
    ha.update(ENTITY_ID, counter.value);
});

ha.frontend.installCard();

ha.log(`Counter Card started — current value: ${counter.value}`);

/* __JSA_CARD__
Ly8gPT09IENPVU5URVIgQ0FSRCAoSlNBIFNjcmlwdCBQYWNrIEV4YW1wbGUpID09PQpjbGFzcyBDb3VudGVyQ2FyZCBleHRlbmRzIEhUTUxFbGVtZW50IHsKICBjb25zdHJ1Y3RvcigpIHsKICAgIHN1cGVyKCk7CiAgICB0aGlzLmF0dGFjaFNoYWRvdyh7IG1vZGU6ICdvcGVuJyB9KTsKICAgIHRoaXMuX2hhc3MgPSBudWxsOwogICAgdGhpcy5fbGFzdCA9IG51bGw7CiAgfQoKICBzZXRDb25maWcoY29uZmlnKSB7CiAgICB0aGlzLl9jb25maWcgPSBjb25maWc7CiAgICB0aGlzLl9lbnRpdHlJZCA9ICdudW1iZXIuJyArIF9fanNhX18uc2NyaXB0SWQ7CiAgfQoKICBzZXQgaGFzcyhoYXNzKSB7CiAgICB0aGlzLl9oYXNzID0gaGFzczsKICAgIF9fanNhX18uY29ubmVjdChoYXNzKTsKICAgIHZhciBlaWQgPSB0aGlzLl9lbnRpdHlJZCB8fCAoJ251bWJlci4nICsgX19qc2FfXy5zY3JpcHRJZCk7CiAgICB2YXIgc3RhdGVPYmogPSBoYXNzLnN0YXRlc1tlaWRdOwogICAgdmFyIHZhbCA9IHN0YXRlT2JqID8gcGFyc2VJbnQoc3RhdGVPYmouc3RhdGUsIDEwKSA6IDA7CiAgICBpZiAoaXNOYU4odmFsKSkgdmFsID0gMDsKICAgIGlmICh2YWwgPT09IHRoaXMuX2xhc3QpIHJldHVybjsKICAgIHRoaXMuX2xhc3QgPSB2YWw7CiAgICB0aGlzLl9yZW5kZXIodmFsKTsKICB9CgogIF9yZW5kZXIodmFsdWUpIHsKICAgIHZhciByID0gdGhpcy5zaGFkb3dSb290OwogICAgdmFyIG1pbnVzVmlzaWJpbGl0eSA9IHZhbHVlID4gMCA/ICd2aXNpYmxlJyA6ICdoaWRkZW4nOwogICAgci5pbm5lckhUTUwgPQogICAgICAnPHN0eWxlPicgKwogICAgICAnOmhvc3R7ZGlzcGxheTpibG9ja30nICsKICAgICAgJ2hhLWNhcmR7cGFkZGluZzoyNHB4IDE2cHg7dGV4dC1hbGlnbjpjZW50ZXJ9JyArCiAgICAgICcucm93e2Rpc3BsYXk6ZmxleDthbGlnbi1pdGVtczpjZW50ZXI7anVzdGlmeS1jb250ZW50OmNlbnRlcjtnYXA6MjRweH0nICsKICAgICAgJy5idG57YmFja2dyb3VuZDp2YXIoLS1wcmltYXJ5LWNvbG9yKTtjb2xvcjojZmZmO2JvcmRlcjpub25lO2JvcmRlci1yYWRpdXM6NTAlOycgKwogICAgICAgICd3aWR0aDo1MnB4O2hlaWdodDo1MnB4O2ZvbnQtc2l6ZToxLjZlbTtjdXJzb3I6cG9pbnRlcjtsaW5lLWhlaWdodDoxO3RyYW5zaXRpb246b3BhY2l0eSAuMTVzfScgKwogICAgICAnLmJ0bjphY3RpdmV7b3BhY2l0eTouNn0nICsKICAgICAgJy5taW51c3t2aXNpYmlsaXR5OicgKyBtaW51c1Zpc2liaWxpdHkgKyAnfScgKwogICAgICAnLnZhbHtmb250LXNpemU6M2VtO2ZvbnQtd2VpZ2h0OjcwMDttaW4td2lkdGg6ODBweDtjb2xvcjp2YXIoLS1wcmltYXJ5LXRleHQtY29sb3IpfScgKwogICAgICAnPC9zdHlsZT4nICsKICAgICAgJzxoYS1jYXJkPicgKwogICAgICAgICc8ZGl2IGNsYXNzPSJyb3ciPicgKwogICAgICAgICAgJzxidXR0b24gY2xhc3M9ImJ0biBtaW51cyIgaWQ9ImRlYyI+4oiSPC9idXR0b24+JyArCiAgICAgICAgICAnPGRpdiBjbGFzcz0idmFsIj4nICsgdmFsdWUgKyAnPC9kaXY+JyArCiAgICAgICAgICAnPGJ1dHRvbiBjbGFzcz0iYnRuIiBpZD0iaW5jIj4rPC9idXR0b24+JyArCiAgICAgICAgJzwvZGl2PicgKwogICAgICAnPC9oYS1jYXJkPic7CiAgICByLmdldEVsZW1lbnRCeUlkKCdkZWMnKS5vbmNsaWNrID0gZnVuY3Rpb24oKSB7IF9fanNhX18uY2FsbEFjdGlvbignZGVjcmVhc2UnLCB7fSkuY2F0Y2goZnVuY3Rpb24oKXt9KTsgfTsKICAgIHIuZ2V0RWxlbWVudEJ5SWQoJ2luYycpLm9uY2xpY2sgPSBmdW5jdGlvbigpIHsgX19qc2FfXy5jYWxsQWN0aW9uKCdpbmNyZWFzZScsIHt9KS5jYXRjaChmdW5jdGlvbigpe30pOyB9OwogIH0KCiAgZ2V0Q2FyZFNpemUoKSB7IHJldHVybiAyOyB9CiAgc3RhdGljIGdldFN0dWJDb25maWcoKSB7IHJldHVybiB7fTsgfQp9Cgp0cnkgeyBjdXN0b21FbGVtZW50cy5kZWZpbmUoJ2NvdW50ZXItY2FyZCcsIENvdW50ZXJDYXJkKTsgfSBjYXRjaChfKSB7fQo=
__JSA_CARD_END__ */
