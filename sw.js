/**
 * Plant Diary - Service Worker
 * 백그라운드 푸시 알림 및 오프라인 캐싱 지원
 */

const CACHE_NAME = 'plant-diary-v1';
const ASSETS = [
    '/',
    '/index.html',
    '/css/style.css',
    '/js/api.js',
    '/js/app.js',
];

// 설치 시 캐싱
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
    );
    self.skipWaiting();
});

// 활성화 시 이전 캐시 정리
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        )
    );
    self.clients.claim();
});

// 네트워크 우선, 실패 시 캐시
self.addEventListener('fetch', (event) => {
    event.respondWith(
        fetch(event.request).catch(() => caches.match(event.request))
    );
});

// 푸시 알림 수신
self.addEventListener('push', (event) => {
    let data = { title: '🌱 Plant Diary', body: '식물 관리 알림입니다!' };
    if (event.data) {
        try {
            data = event.data.json();
        } catch (e) {
            data.body = event.data.text();
        }
    }

    const options = {
        body: data.body,
        icon: data.icon || '/img/icon-192.png',
        badge: '/img/icon-192.png',
        vibrate: [200, 100, 200],
        tag: data.tag || 'plant-care',
        data: data.url || '/',
        actions: [
            { action: 'open', title: '열기' },
            { action: 'dismiss', title: '닫기' },
        ],
    };

    event.waitUntil(
        self.registration.showNotification(data.title || '🌱 Plant Diary', options)
    );
});

// 알림 클릭
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    if (event.action === 'dismiss') return;

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
            for (const client of clientList) {
                if (client.url.includes('index.html') && 'focus' in client) {
                    return client.focus();
                }
            }
            return clients.openWindow(event.notification.data || '/');
        })
    );
});

// 주기적 동기화 (Background Sync)
self.addEventListener('periodicsync', (event) => {
    if (event.tag === 'check-plant-schedules') {
        event.waitUntil(checkSchedulesAndNotify());
    }
});

// 일반 동기화 (단발성)
self.addEventListener('sync', (event) => {
    if (event.tag === 'check-plant-schedules') {
        event.waitUntil(checkSchedulesAndNotify());
    }
});

async function checkSchedulesAndNotify() {
    // IndexedDB나 외부 서버에서 스케줄 확인 후 알림 발송
    // (LocalStorage는 Service Worker에서 접근 불가하므로 메시지로 처리)
    const clients = await self.clients.matchAll();
    clients.forEach(client => {
        client.postMessage({ type: 'CHECK_SCHEDULES' });
    });
}
