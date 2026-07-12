/**
 * Plant Diary - 메인 앱 로직
 */

// 상태 관리
let currentLocationId = null;
let currentLocationName = '';
let currentPlantId = null;

// DOM 요소
const views = {
    locations: document.getElementById('view-locations'),
    plants: document.getElementById('view-plants'),
    plantDetail: document.getElementById('view-plant-detail'),
    shops: document.getElementById('view-shops'),
};

// ============ 뷰 전환 ============

function showView(viewName) {
    Object.values(views).forEach(v => v.classList.remove('active'));
    views[viewName].classList.add('active');
    // 날씨 위젯은 메인(장소 목록)에서만 표시
    const weatherEl = document.getElementById('weather-widget');
    if (weatherEl) {
        weatherEl.style.display = viewName === 'locations' ? '' : 'none';
    }
}

// ============ 장소 관련 ============

async function loadLocations() {
    const list = document.getElementById('location-list');
    try {
        const locations = await api.getLocations();
        if (locations.length === 0) {
            list.innerHTML = `
                <div class="empty-state">
                    <span class="empty-icon">🏡</span>
                    <h3>아직 등록된 장소가 없어요</h3>
                    <p>+ 장소 추가 버튼을 눌러 시작해보세요</p>
                </div>
            `;
            return;
        }

        // 각 장소별 식물 목록을 병렬로 로드
        const locationPlants = await Promise.all(
            locations.map(loc => api.getPlantsByLocation(loc.id).catch(() => []))
        );

        list.innerHTML = locations.map((loc, idx) => {
            const plants = locationPlants[idx] || [];
            const plantIcons = plants.slice(0, 6).map(plant => `
                <div class="plant-icon-item" title="${escapeAttr(plant.name)}">
                    ${plant.imageUrl
                        ? `<img src="${api.getImageUrl(plant.imageUrl)}" alt="${escapeAttr(plant.name)}" class="plant-icon-img">`
                        : `<div class="plant-icon-placeholder">🪴</div>`
                    }
                    <span class="plant-icon-name">${escapeHtml(plant.name)}</span>
                </div>
            `).join('');
            const moreCount = plants.length > 6 ? plants.length - 6 : 0;

            return `
            <div class="card location-card" data-id="${loc.id}">
                <div class="card-body">
                    <h3 class="card-title">📍 ${escapeHtml(loc.name)}</h3>
                    ${loc.description ? `<p class="card-desc">${escapeHtml(loc.description)}</p>` : ''}
                    <span class="badge">${loc.plantCount || 0}개의 식물</span>
                    ${plants.length > 0 ? `
                        <div class="plant-icons-row">
                            ${plantIcons}
                            ${moreCount > 0 ? `<div class="plant-icon-more">+${moreCount}</div>` : ''}
                        </div>
                        <div class="bulk-care-row">
                            <button class="btn-bulk-care water" onclick="event.stopPropagation(); bulkCare(${loc.id}, 'water')" title="전체 물주기">💧</button>
                            <button class="btn-bulk-care repot" onclick="event.stopPropagation(); bulkCare(${loc.id}, 'repot')" title="전체 분갈이">🪴</button>
                            <button class="btn-bulk-care pest" onclick="event.stopPropagation(); bulkCare(${loc.id}, 'pest')" title="전체 병충해">🐛</button>
                        </div>
                    ` : ''}
                </div>
                <div class="card-actions">
                    <button class="btn btn-sm btn-outline" onclick="editLocation(${loc.id}, '${escapeAttr(loc.name)}', '${escapeAttr(loc.description || '')}')">수정</button>
                    <button class="btn btn-sm btn-danger" onclick="deleteLocation(${loc.id}, '${escapeAttr(loc.name)}')">삭제</button>
                </div>
            </div>
        `}).join('');

        // 카드 클릭 이벤트 (버튼 제외)
        list.querySelectorAll('.location-card .card-body').forEach(card => {
            card.addEventListener('click', () => {
                const id = card.parentElement.dataset.id;
                const name = card.querySelector('.card-title').textContent.replace('📍 ', '');
                openPlantList(id, name);
            });
        });
    } catch (error) {
        list.innerHTML = `<div class="error-state">⚠️ ${error.message}</div>`;
    }
}

function openLocationModal(id = '', name = '', desc = '') {
    document.getElementById('location-id').value = id;
    document.getElementById('location-name').value = name;
    document.getElementById('location-desc').value = desc;
    document.getElementById('modal-location-title').textContent = id ? '장소 수정' : '장소 추가';
    document.getElementById('modal-location').classList.add('active');
}

function editLocation(id, name, desc) {
    openLocationModal(id, name, desc);
}

async function deleteLocation(id, name) {
    if (!confirm(`"${name}" 장소와 소속된 모든 식물을 삭제하시겠습니까?`)) return;
    try {
        await api.deleteLocation(id);
        await loadLocations();
    } catch (error) {
        alert(error.message);
    }
}

// ============ 일괄 케어 기록 ============

async function bulkCare(locationId, type) {
    const typeLabels = { water: '💧 물주기', repot: '🪴 분갈이', pest: '🐛 병충해' };
    const label = typeLabels[type] || type;
    const today = new Date().toISOString().split('T')[0];

    if (!confirm(`이 장소의 모든 식물에 오늘(${today}) "${label}" 기록을 추가할까요?`)) return;

    try {
        const plants = await api.getPlantsByLocation(locationId);
        const promises = plants.map(plant =>
            api.addCareRecord(plant.id, { date: today, type, note: null })
        );
        await Promise.all(promises);

        // 완료 피드백
        showBulkToast(`${label} 완료! (${plants.length}개 식물)`);
    } catch (error) {
        alert('일괄 기록 실패: ' + error.message);
    }
}

function showBulkToast(message) {
    // 간단한 토스트 알림
    let toast = document.getElementById('bulk-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'bulk-toast';
        toast.className = 'bulk-toast';
        document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2500);
}

// ============ 식물 목록 ============

async function openPlantList(locationId, locationName) {
    currentLocationId = locationId;
    currentLocationName = locationName;
    document.getElementById('plants-title').textContent = `📍 ${locationName}`;
    showView('plants');
    await loadPlants();
}

async function loadPlants() {
    const list = document.getElementById('plant-list');
    try {
        const plants = await api.getPlantsByLocation(currentLocationId);
        if (plants.length === 0) {
            list.innerHTML = `
                <div class="empty-state">
                    <span class="empty-icon">🌿</span>
                    <h3>아직 등록된 식물이 없어요</h3>
                    <p>+ 식물 추가 버튼을 눌러 식물을 등록해보세요</p>
                </div>
            `;
            return;
        }
        list.innerHTML = `<div class="plant-list-view">${plants.map(plant => `
            <div class="plant-list-item${plant.isDead ? ' plant-dead' : ''}" onclick="openPlantDetail('${plant.id}')">
                <div class="plant-list-thumb">
                    ${plant.imageUrl
                        ? `<img src="${api.getImageUrl(plant.imageUrl)}" alt="${escapeAttr(plant.name)}">`
                        : `<div class="plant-list-thumb-placeholder">🪴</div>`
                    }
                </div>
                <div class="plant-list-info">
                    <h3 class="plant-list-name">${escapeHtml(plant.name)}${plant.isDead ? ' <span class="dead-tag">💀 고사</span>' : ''}</h3>
                    <div class="plant-list-meta">
                        ${plant.purchaseDate ? `<span>📅 ${formatDate(plant.purchaseDate)}</span>` : ''}
                        ${plant.purchasePlace ? `<span>🏪 ${escapeHtml(plant.purchasePlace)}</span>` : ''}
                    </div>
                </div>
                <div class="plant-list-price">
                    ${plant.price ? `<span class="price-tag">${formatPrice(plant.price)}원</span>` : ''}
                </div>
                <div class="plant-list-arrow">›</div>
            </div>
        `).join('')}</div>`;
    } catch (error) {
        list.innerHTML = `<div class="error-state">⚠️ ${error.message}</div>`;
    }
}

// ============ 식물 상세 ============

async function openPlantDetail(plantId) {
    currentPlantId = plantId;
    showView('plantDetail');
    const content = document.getElementById('plant-detail-content');
    try {
        const plant = await api.getPlant(plantId);
        const schedule = getPlantSchedule(plantId);
        const isDead = plant.isDead === true;

        // 고사 버튼 텍스트 변경
        const deadBtn = document.getElementById('btn-dead-plant');
        if (deadBtn) {
            deadBtn.textContent = isDead ? '🌱 회생' : '💀 고사';
        }

        content.innerHTML = `
            ${isDead ? `<div class="dead-overlay"><span class="dead-badge">💀 고사 (${plant.deadDate || ''})</span></div>` : ''}
            <div class="${isDead ? 'dead-content' : ''}">
            <div class="detail-image" id="detail-image-area">
                ${plant.imageUrl
                    ? `<img src="${api.getImageUrl(plant.imageUrl)}" alt="${escapeAttr(plant.name)}" id="detail-img">`
                    : `<div class="detail-image-placeholder">🪴<br>사진 없음</div>`
                }
                <button class="btn-camera" id="btn-take-photo" title="사진 촬영/변경">📷</button>
                <input type="file" id="camera-input" accept="image/*" capture hidden>
            </div>
            <h2 class="detail-name">${escapeHtml(plant.name)}</h2>
            <div class="detail-info">
                ${plant.price ? `
                    <div class="info-row">
                        <span class="info-label">💰 가격</span>
                        <span class="info-value">${formatPrice(plant.price)}원</span>
                    </div>
                ` : ''}
                ${plant.purchaseDate ? `
                    <div class="info-row">
                        <span class="info-label">📅 구입 날짜</span>
                        <span class="info-value">${formatDate(plant.purchaseDate)}</span>
                    </div>
                ` : ''}
                ${plant.purchasePlace ? `
                    <div class="info-row">
                        <span class="info-label">🏪 구매한 곳</span>
                        <span class="info-value">${escapeHtml(plant.purchasePlace)}</span>
                    </div>
                ` : ''}
                ${plant.memo ? `
                    <div class="info-row info-memo">
                        <span class="info-label">📝 메모</span>
                        <p class="info-memo-text">${escapeHtml(plant.memo)}</p>
                    </div>
                ` : ''}
            </div>

            <!-- 케어 캘린더 - 랩다이어리 스타일 -->
            <div class="care-calendar-section">
                <div class="care-calendar-header">
                    <h3>🗓️ 관리 기록</h3>
                    <div class="care-legend">
                        <span class="legend-item"><span class="legend-dot water"></span>물주기</span>
                        <span class="legend-item"><span class="legend-dot repot"></span>분갈이</span>
                        <span class="legend-item"><span class="legend-dot pest"></span>병충해</span>
                    </div>
                </div>
                <div class="care-calendar-nav">
                    <button class="btn btn-sm btn-back" id="cal-prev">‹</button>
                    <span id="cal-month-label"></span>
                    <button class="btn btn-sm btn-back" id="cal-next">›</button>
                </div>
                <div class="lab-calendar" id="care-calendar"></div>
                <div class="lab-day-panel" id="lab-day-panel"></div>
                <div class="care-records-list" id="care-records-list"></div>
            </div>

            <!-- 예약/알람 설정 -->
            <div class="schedule-section">
                <h3>⏰ 예약 알림 설정</h3>
                <div class="schedule-cards">
                    <div class="schedule-card water">
                        <div class="schedule-card-header">
                            <span>💧 물주기</span>
                            <label class="toggle-switch">
                                <input type="checkbox" id="sched-water-on" ${schedule.water.enabled ? 'checked' : ''}>
                                <span class="toggle-slider"></span>
                            </label>
                        </div>
                        <div class="schedule-card-body">
                            <label>간격 (일)</label>
                            <input type="number" id="sched-water-days" min="1" max="90" value="${schedule.water.days}" class="sched-input">
                            <label>알림 시간</label>
                            <input type="time" id="sched-water-time" value="${schedule.water.time}" class="sched-input">
                            ${schedule.water.nextDate ? `<p class="sched-next">다음: <strong>${schedule.water.nextDate}</strong></p>` : ''}
                        </div>
                    </div>
                    <div class="schedule-card repot">
                        <div class="schedule-card-header">
                            <span>🪴 분갈이</span>
                            <label class="toggle-switch">
                                <input type="checkbox" id="sched-repot-on" ${schedule.repot.enabled ? 'checked' : ''}>
                                <span class="toggle-slider"></span>
                            </label>
                        </div>
                        <div class="schedule-card-body">
                            <label>간격 (일)</label>
                            <input type="number" id="sched-repot-days" min="1" max="365" value="${schedule.repot.days}" class="sched-input">
                            <label>알림 시간</label>
                            <input type="time" id="sched-repot-time" value="${schedule.repot.time}" class="sched-input">
                            ${schedule.repot.nextDate ? `<p class="sched-next">다음: <strong>${schedule.repot.nextDate}</strong></p>` : ''}
                        </div>
                    </div>
                </div>
                <button class="btn btn-primary btn-full" id="btn-save-schedule">💾 예약 저장</button>
            </div>
            </div>
        `;

        // 캘린더 초기화
        initCareCalendar(plantId);

        // 카메라 촬영 이벤트
        document.getElementById('btn-take-photo').addEventListener('click', () => {
            document.getElementById('camera-input').click();
        });
        document.getElementById('camera-input').addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            try {
                const result = await api.uploadImage(file);
                const imageUrl = result.imageUrl;
                await api.updatePlant(plantId, { ...plant, imageUrl });
                // 이미지 즉시 반영
                const imgArea = document.getElementById('detail-image-area');
                const existingImg = document.getElementById('detail-img');
                if (existingImg) {
                    existingImg.src = api.getImageUrl(imageUrl);
                } else {
                    imgArea.innerHTML = `
                        <img src="${api.getImageUrl(imageUrl)}" alt="${escapeAttr(plant.name)}" id="detail-img">
                        <button class="btn-camera" id="btn-take-photo" title="사진 촬영/변경">📷</button>
                        <input type="file" id="camera-input" accept="image/*" capture hidden>
                    `;
                }
                showBulkToast('📷 사진이 업데이트되었습니다!');
            } catch (error) {
                alert('사진 업로드 실패: ' + error.message);
            }
        });

        // 예약 저장 이벤트
        document.getElementById('btn-save-schedule').addEventListener('click', () => {
            savePlantSchedule(plantId);
        });

    } catch (error) {
        content.innerHTML = `<div class="error-state">⚠️ ${error.message}</div>`;
    }
}

// ============ 예약/알람 기능 ============

function getPlantSchedule(plantId) {
    const data = localStorage.getItem(`pd_schedule_${plantId}`);
    if (data) return JSON.parse(data);
    return {
        water: { enabled: false, days: 7, time: '09:00', nextDate: null },
        repot: { enabled: false, days: 180, time: '09:00', nextDate: null },
    };
}

function savePlantSchedule(plantId) {
    const schedule = {
        water: {
            enabled: document.getElementById('sched-water-on').checked,
            days: parseInt(document.getElementById('sched-water-days').value) || 7,
            time: document.getElementById('sched-water-time').value || '09:00',
            nextDate: null,
        },
        repot: {
            enabled: document.getElementById('sched-repot-on').checked,
            days: parseInt(document.getElementById('sched-repot-days').value) || 180,
            time: document.getElementById('sched-repot-time').value || '09:00',
            nextDate: null,
        },
    };

    // 다음 예약일 계산
    const today = new Date();
    if (schedule.water.enabled) {
        const next = new Date(today);
        next.setDate(next.getDate() + schedule.water.days);
        schedule.water.nextDate = next.toISOString().split('T')[0];
    }
    if (schedule.repot.enabled) {
        const next = new Date(today);
        next.setDate(next.getDate() + schedule.repot.days);
        schedule.repot.nextDate = next.toISOString().split('T')[0];
    }

    localStorage.setItem(`pd_schedule_${plantId}`, JSON.stringify(schedule));

    // 알림 권한 요청 및 알림 예약
    if (schedule.water.enabled || schedule.repot.enabled) {
        requestNotificationPermission();
        scheduleNotifications(plantId, schedule);
    }

    showBulkToast('⏰ 예약이 저장되었습니다!');

    // 화면 갱신 (다음 날짜 표시)
    openPlantDetail(plantId);
}

function requestNotificationPermission() {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'default') {
        Notification.requestPermission();
    }
}

function scheduleNotifications(plantId, schedule) {
    // 기존 타이머 제거
    clearScheduledTimers(plantId);

    const plant = localApi.getPlant ? localApi.getPlant(plantId) : null;
    const plantName = plant ? plant.name : '식물';

    if (schedule.water.enabled && schedule.water.nextDate) {
        scheduleOneNotification(plantId, 'water', schedule.water, plantName);
    }
    if (schedule.repot.enabled && schedule.repot.nextDate) {
        scheduleOneNotification(plantId, 'repot', schedule.repot, plantName);
    }
}

const scheduledTimers = {};

function clearScheduledTimers(plantId) {
    const key = `timer_${plantId}`;
    if (scheduledTimers[key]) {
        scheduledTimers[key].forEach(id => clearTimeout(id));
        delete scheduledTimers[key];
    }
}

function scheduleOneNotification(plantId, type, config, plantName) {
    const [hours, minutes] = config.time.split(':').map(Number);
    const targetDate = new Date(config.nextDate + 'T00:00:00');
    targetDate.setHours(hours, minutes, 0, 0);

    const now = new Date();
    const delay = targetDate.getTime() - now.getTime();

    if (delay <= 0) {
        // 이미 지난 시간이면 즉시 알림
        showCareNotification(plantName, type);
        return;
    }

    // 브라우저 세션 동안만 유효 (장기 알림은 Service Worker 필요)
    const key = `timer_${plantId}`;
    if (!scheduledTimers[key]) scheduledTimers[key] = [];

    const timerId = setTimeout(() => {
        showCareNotification(plantName, type);
    }, Math.min(delay, 2147483647)); // setTimeout 최대값 제한

    scheduledTimers[key].push(timerId);
}

function showCareNotification(plantName, type) {
    sendPushNotification(plantName, type);
}

// 앱 시작 시 모든 예약 체크
function checkAllSchedules() {
    registerServiceWorker();
    requestNotificationPermission();
    const today = new Date().toISOString().split('T')[0];

    // LocalStorage에서 모든 스케줄 확인
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('pd_schedule_')) {
            const plantId = key.replace('pd_schedule_', '');
            const schedule = JSON.parse(localStorage.getItem(key));
            const plant = localApi.getPlant ? localApi.getPlant(parseInt(plantId)) : null;
            const plantName = plant ? plant.name : '식물';

            if (schedule.water.enabled && schedule.water.nextDate && schedule.water.nextDate <= today) {
                sendPushNotification(plantName, 'water');
            }
            if (schedule.repot.enabled && schedule.repot.nextDate && schedule.repot.nextDate <= today) {
                sendPushNotification(plantName, 'repot');
            }
        }
    }

    // 주기적 체크 (1시간 마다)
    setInterval(() => checkAllSchedules(), 60 * 60 * 1000);
}

// Service Worker 등록
async function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    try {
        const registration = await navigator.serviceWorker.register('/sw.js');
        console.log('✅ Service Worker 등록 완료');

        // 주기적 동기화 등록 (지원하는 브라우저에서만)
        if ('periodicSync' in registration) {
            try {
                await registration.periodicSync.register('check-plant-schedules', {
                    minInterval: 60 * 60 * 1000, // 1시간
                });
            } catch (e) {
                // periodicSync 미지원 시 무시
            }
        }

        // Service Worker로부터 메시지 수신
        navigator.serviceWorker.addEventListener('message', (event) => {
            if (event.data.type === 'CHECK_SCHEDULES') {
                checkAllSchedules();
            }
        });

    } catch (e) {
        console.log('Service Worker 등록 실패:', e);
    }
}

// 핸드폰 푸시 알림 전송
function sendPushNotification(plantName, type) {
    const messages = {
        water: `💧 ${plantName}에게 물을 줄 시간이에요!`,
        repot: `🪴 ${plantName}의 분갈이 예정일입니다!`,
    };
    const body = messages[type] || `🌱 ${plantName} 관리 알림`;

    // 1. 브라우저 내 토스트
    showBulkToast(body);

    // 2. 시스템 푸시 알림 (핸드폰 알림창에 표시)
    if ('Notification' in window && Notification.permission === 'granted') {
        if (navigator.serviceWorker && navigator.serviceWorker.controller) {
            // Service Worker를 통한 알림 (앱이 백그라운드일 때도 동작)
            navigator.serviceWorker.ready.then(registration => {
                registration.showNotification('🌱 Plant Diary', {
                    body: body,
                    icon: '/img/icon-192.png',
                    badge: '/img/icon-192.png',
                    vibrate: [200, 100, 200],
                    tag: `plant-${type}-${Date.now()}`,
                    requireInteraction: true,
                    actions: [
                        { action: 'open', title: '확인' },
                        { action: 'dismiss', title: '닫기' },
                    ],
                });
            });
        } else {
            // 일반 Notification (포그라운드)
            new Notification('🌱 Plant Diary', {
                body: body,
                icon: '/img/icon-192.png',
                vibrate: [200, 100, 200],
                tag: `plant-${type}`,
            });
        }
    }

    // 3. 진동 (모바일)
    if ('vibrate' in navigator) {
        navigator.vibrate([200, 100, 200]);
    }
}

// ============ 케어 캘린더 (랩다이어리 스타일) ============

let calYear, calMonth;

function initCareCalendar(plantId) {
    const now = new Date();
    calYear = now.getFullYear();
    calMonth = now.getMonth() + 1;

    // 네비게이션
    document.getElementById('cal-prev').addEventListener('click', () => {
        calMonth--;
        if (calMonth < 1) { calMonth = 12; calYear--; }
        renderCalendar(plantId);
    });
    document.getElementById('cal-next').addEventListener('click', () => {
        calMonth++;
        if (calMonth > 12) { calMonth = 1; calYear++; }
        renderCalendar(plantId);
    });

    renderCalendar(plantId);
}

async function renderCalendar(plantId) {
    const label = document.getElementById('cal-month-label');
    label.textContent = `${calYear}년 ${calMonth}월`;

    const records = await api.getCareRecordsByMonth(plantId, calYear, calMonth);
    const calEl = document.getElementById('care-calendar');
    const listEl = document.getElementById('care-records-list');
    const panelEl = document.getElementById('lab-day-panel');

    const daysInMonth = new Date(calYear, calMonth, 0).getDate();
    const firstDayOfWeek = new Date(calYear, calMonth - 1, 1).getDay(); // 0=일
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];

    // 날짜별 기록 맵
    const dateMap = {};
    records.forEach(r => {
        if (!dateMap[r.date]) dateMap[r.date] = {};
        dateMap[r.date][r.type] = r;
    });

    // 월간 캘린더 그리드 렌더링
    let html = '<div class="lab-cal-grid">';
    // 요일 헤더
    const dayNames = ['일','월','화','수','목','금','토'];
    dayNames.forEach((name, i) => {
        const cls = i === 0 ? ' sunday' : i === 6 ? ' saturday' : '';
        html += `<div class="lab-cal-dayname${cls}">${name}</div>`;
    });

    // 첫 주 빈 칸
    for (let i = 0; i < firstDayOfWeek; i++) {
        html += '<div class="lab-cal-cell empty"></div>';
    }

    // 날짜 칸
    for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${calYear}-${String(calMonth).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        const dayRecords = dateMap[dateStr] || {};
        const isToday = dateStr === todayStr;
        const dayOfWeek = (firstDayOfWeek + d - 1) % 7;
        const isSunday = dayOfWeek === 0;
        const isSaturday = dayOfWeek === 6;

        const hasWater = !!dayRecords['water'];
        const hasRepot = !!dayRecords['repot'];
        const hasPest = !!dayRecords['pest'];
        const hasAny = hasWater || hasRepot || hasPest;

        // 도트 표시
        const dots = [
            hasWater ? '<span class="lab-dot water"></span>' : '',
            hasRepot ? '<span class="lab-dot repot"></span>' : '',
            hasPest ? '<span class="lab-dot pest"></span>' : '',
        ].filter(Boolean).join('');

        html += `
            <div class="lab-cal-cell${isToday ? ' today' : ''}${hasAny ? ' has-record' : ''}" data-date="${dateStr}">
                <span class="lab-cal-num${isSunday ? ' sunday' : ''}${isSaturday ? ' saturday' : ''}">${d}</span>
                <div class="lab-cal-dots">${dots}</div>
            </div>
        `;
    }
    html += '</div>';
    calEl.innerHTML = html;

    // 날짜 칸 클릭 이벤트
    calEl.querySelectorAll('.lab-cal-cell[data-date]').forEach(cell => {
        cell.addEventListener('click', () => {
            // 선택 상태 표시
            calEl.querySelectorAll('.lab-cal-cell').forEach(c => c.classList.remove('selected'));
            cell.classList.add('selected');
            // 해당 날짜의 케어 패널 열기
            openDayPanel(plantId, cell.dataset.date, dateMap[cell.dataset.date] || {}, records);
        });
    });

    // 패널 초기 상태: 숨김
    panelEl.innerHTML = '<p class="lab-panel-hint">📅 날짜를 클릭하면 관리 기록을 입력할 수 있습니다</p>';

    // 하단 요약
    const waterCount = records.filter(r => r.type === 'water').length;
    const repotCount = records.filter(r => r.type === 'repot').length;
    const pestCount = records.filter(r => r.type === 'pest').length;

    listEl.innerHTML = `
        <div class="notion-summary">
            <span class="notion-summary-item">💧 물주기 <strong>${waterCount}</strong>회</span>
            <span class="notion-summary-item">🪴 분갈이 <strong>${repotCount}</strong>회</span>
            <span class="notion-summary-item">🐛 병충해 <strong>${pestCount}</strong>회</span>
        </div>
    `;
}

function openDayPanel(plantId, dateStr, dayRecords, allRecords) {
    const panelEl = document.getElementById('lab-day-panel');
    const d = parseInt(dateStr.split('-')[2]);
    const dayOfWeek = new Date(dateStr).getDay();
    const dayNames = ['일','월','화','수','목','금','토'];

    const hasWater = !!dayRecords['water'];
    const hasRepot = !!dayRecords['repot'];
    const hasPest = !!dayRecords['pest'];

    // 해당 날짜의 메모
    const notes = allRecords.filter(r => r.date === dateStr && r.note).map(r => r.note);
    const noteText = notes.join(', ');

    panelEl.innerHTML = `
        <div class="lab-panel-content">
            <div class="lab-panel-date">
                <strong>${calMonth}월 ${d}일</strong> (${dayNames[dayOfWeek]})
            </div>
            <div class="lab-panel-buttons">
                <button class="lab-care-btn${hasWater ? ' active' : ''}" data-type="water" onclick="toggleDayCare('${plantId}', '${dateStr}', 'water', ${!hasWater})">
                    <span class="lab-care-icon">💧</span>
                    <span class="lab-care-label">물주기</span>
                </button>
                <button class="lab-care-btn${hasRepot ? ' active' : ''}" data-type="repot" onclick="toggleDayCare('${plantId}', '${dateStr}', 'repot', ${!hasRepot})">
                    <span class="lab-care-icon">🪴</span>
                    <span class="lab-care-label">분갈이</span>
                </button>
                <button class="lab-care-btn${hasPest ? ' active' : ''}" data-type="pest" onclick="toggleDayCare('${plantId}', '${dateStr}', 'pest', ${!hasPest})">
                    <span class="lab-care-icon">🐛</span>
                    <span class="lab-care-label">병충해</span>
                </button>
            </div>
            <div class="lab-panel-note">
                <div class="lab-note-row">
                    <input type="text" id="lab-note-input" class="lab-note-input" placeholder="메모 입력..." value="${escapeAttr(noteText)}" maxlength="200">
                    <button class="btn btn-sm btn-primary" onclick="saveDayNote('${plantId}', '${dateStr}')">저장</button>
                </div>
            </div>
        </div>
    `;
}

async function toggleDayCare(plantId, date, type, add) {
    if (add) {
        await api.addCareRecord(plantId, { date, type, note: null });
    } else {
        const records = await api.getCareRecords(plantId);
        const toDelete = records.filter(r => r.date === date && r.type === type);
        if (toDelete.length > 0) {
            await api.deleteCareRecords(toDelete.map(r => r.id));
        }
    }
    renderCalendar(plantId);
    // 다시 해당 날짜 패널 열기
    const updatedRecords = await api.getCareRecordsByMonth(plantId, calYear, calMonth);
    const dateMap = {};
    updatedRecords.forEach(r => {
        if (!dateMap[r.date]) dateMap[r.date] = {};
        dateMap[r.date][r.type] = r;
    });
    openDayPanel(plantId, date, dateMap[date] || {}, updatedRecords);
    // 선택 상태 유지
    const cell = document.querySelector(`.lab-cal-cell[data-date="${date}"]`);
    if (cell) cell.classList.add('selected');
}

async function saveDayNote(plantId, date) {
    const input = document.getElementById('lab-note-input');
    const note = input ? input.value.trim() : '';
    const records = await api.getCareRecords(plantId);
    const existing = records.filter(r => r.date === date && r.note);

    if (note) {
        if (existing.length > 0) {
            // 기존 메모 수정
            await api.updateCareRecord(existing[0].id, { note });
            for (let i = 1; i < existing.length; i++) {
                await api.updateCareRecord(existing[i].id, { note: null });
            }
        } else {
            // 기록이 있으면 첫 번째에 메모 추가, 없으면 새로 생성
            const dayRecords = records.filter(r => r.date === date);
            if (dayRecords.length > 0) {
                await api.updateCareRecord(dayRecords[0].id, { note });
            } else {
                await api.addCareRecord(plantId, { date, type: 'water', note });
            }
        }
    } else if (existing.length > 0) {
        // 메모 삭제
        for (const r of existing) {
            await api.updateCareRecord(r.id, { note: null });
        }
    }

    renderCalendar(plantId);
    // 패널 다시 열기
    const updatedRecords = await api.getCareRecordsByMonth(plantId, calYear, calMonth);
    const dateMap = {};
    updatedRecords.forEach(r => {
        if (!dateMap[r.date]) dateMap[r.date] = {};
        dateMap[r.date][r.type] = r;
    });
    openDayPanel(plantId, date, dateMap[date] || {}, updatedRecords);
    const cell = document.querySelector(`.lab-cal-cell[data-date="${date}"]`);
    if (cell) cell.classList.add('selected');
}

async function toggleCareRecord(plantId, date, type, checked, existingId) {
    if (checked) {
        // 체크: 기록 추가
        const noteEl = document.getElementById('care-note');
        const note = noteEl ? noteEl.value.trim() : '';
        await api.addCareRecord(plantId, { date, type, note: note || null });
        if (noteEl) noteEl.value = '';
    } else {
        // 체크 해제: 해당 날짜+타입 기록을 찾아서 삭제
        const records = await api.getCareRecords(plantId);
        const toDelete = records.filter(r => r.date === date && r.type === type);
        if (toDelete.length > 0) {
            await api.deleteCareRecords(toDelete.map(r => r.id));
        }
    }
    renderCalendar(plantId);
}

async function addNoteToDate(plantId, date) {
    const records = await api.getCareRecords(plantId);
    const existing = records.filter(r => r.date === date && r.note);

    if (existing.length > 0) {
        // 기존 메모가 있으면 수정 모드
        const currentNote = existing.map(r => r.note).join(', ');
        const note = prompt('메모를 수정하세요:', currentNote);
        if (note === null) return; // 취소
        if (note.trim() === '') {
            // 빈 문자열이면 메모 삭제 (note만 null로)
            for (const r of existing) {
                await api.updateCareRecord(r.id, { note: null });
            }
        } else {
            // 첫 번째 기록의 메모 수정, 나머지는 메모 제거
            await api.updateCareRecord(existing[0].id, { note: note.trim() });
            for (let i = 1; i < existing.length; i++) {
                await api.updateCareRecord(existing[i].id, { note: null });
            }
        }
    } else {
        // 새 메모 추가
        const note = prompt('메모를 입력하세요:');
        if (note === null || note.trim() === '') return;

        // 해당 날짜에 기록이 있으면 첫 번째에 메모 추가, 없으면 새 기록 생성
        const dayRecords = records.filter(r => r.date === date);
        if (dayRecords.length > 0) {
            await api.updateCareRecord(dayRecords[0].id, { note: note.trim() });
        } else {
            await api.addCareRecord(plantId, { date, type: 'water', note: note.trim() });
        }
    }
    renderCalendar(plantId);
}

async function editNoteOnDate(plantId, date) {
    // 메모 텍스트 클릭 시 수정 (addNoteToDate와 동일하게 동작)
    await addNoteToDate(plantId, date);
}

async function toggleAllCare(plantId, type, checked) {
    const daysInMonth = new Date(calYear, calMonth, 0).getDate();
    const records = await api.getCareRecordsByMonth(plantId, calYear, calMonth);

    if (checked) {
        // 전체 선택: 해당 타입 기록이 없는 날짜에 모두 추가
        const existingDates = new Set(records.filter(r => r.type === type).map(r => r.date));
        for (let d = 1; d <= daysInMonth; d++) {
            const dateStr = `${calYear}-${String(calMonth).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
            if (!existingDates.has(dateStr)) {
                await api.addCareRecord(plantId, { date: dateStr, type, note: null });
            }
        }
    } else {
        // 전체 해제: 해당 타입 기록 모두 삭제 (배치)
        const toDelete = records.filter(r => r.type === type);
        if (toDelete.length > 0) {
            await api.deleteCareRecords(toDelete.map(r => r.id));
        }
    }

    renderCalendar(plantId);
}

async function toggleRowCare(plantId, dateStr, checked) {
    const records = await api.getCareRecordsByMonth(plantId, calYear, calMonth);
    const dayRecords = {};
    records.filter(r => r.date === dateStr).forEach(r => { dayRecords[r.type] = r; });

    const types = ['water', 'repot', 'pest'];

    if (checked) {
        // 해당 날짜에 없는 타입 모두 추가
        for (const type of types) {
            if (!dayRecords[type]) {
                await api.addCareRecord(plantId, { date: dateStr, type, note: null });
            }
        }
    } else {
        // 해당 날짜의 모든 기록 삭제 (배치)
        const idsToDelete = types.filter(type => dayRecords[type]).map(type => dayRecords[type].id);
        if (idsToDelete.length > 0) {
            await api.deleteCareRecords(idsToDelete);
        }
    }

    renderCalendar(plantId);
}

async function toggleAllRows(plantId, checked) {
    const daysInMonth = new Date(calYear, calMonth, 0).getDate();
    const records = await api.getCareRecordsByMonth(plantId, calYear, calMonth);
    const types = ['water', 'repot', 'pest'];

    if (checked) {
        // 모든 날짜 × 모든 타입 추가
        const existing = new Set(records.map(r => `${r.date}_${r.type}`));
        for (let d = 1; d <= daysInMonth; d++) {
            const dateStr = `${calYear}-${String(calMonth).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
            for (const type of types) {
                if (!existing.has(`${dateStr}_${type}`)) {
                    await api.addCareRecord(plantId, { date: dateStr, type, note: null });
                }
            }
        }
    } else {
        // 모든 기록 삭제 (배치)
        if (records.length > 0) {
            await api.deleteCareRecords(records.map(r => r.id));
        }
    }

    renderCalendar(plantId);
}

function getCareTypeLabel(type) {
    switch(type) {
        case 'water': return '💧 물주기';
        case 'repot': return '🪴 분갈이';
        case 'pest': return '🐛 병충해';
        default: return type;
    }
}

async function deleteCareRecord(recordId, plantId) {
    await api.deleteCareRecord(recordId);
    renderCalendar(plantId);
}

// ============ 식물 폼 ============

function openPlantModal(plant = null) {
    document.getElementById('plant-id').value = plant ? plant.id : '';
    document.getElementById('plant-name').value = plant ? plant.name : '';
    document.getElementById('plant-price').value = plant ? (plant.price || '') : '';
    document.getElementById('plant-date').value = plant ? (plant.purchaseDate || '') : '';
    document.getElementById('plant-place').value = plant ? (plant.purchasePlace || '') : '';
    document.getElementById('plant-memo').value = plant ? (plant.memo || '') : '';
    document.getElementById('plant-image-url').value = plant ? (plant.imageUrl || '') : '';
    document.getElementById('modal-plant-title').textContent = plant ? '식물 수정' : '식물 추가';

    // 이미지 미리보기
    const preview = document.getElementById('plant-image-preview');
    const placeholder = document.getElementById('image-placeholder');
    if (plant && plant.imageUrl) {
        preview.src = api.getImageUrl(plant.imageUrl);
        preview.classList.remove('hidden');
        placeholder.classList.add('hidden');
    } else {
        preview.classList.add('hidden');
        placeholder.classList.remove('hidden');
    }

    document.getElementById('modal-plant').classList.add('active');
}

// ============ 통계 ============

async function showStats() {
    document.getElementById('modal-stats').classList.add('active');
    const content = document.getElementById('stats-content');
    content.innerHTML = '<p class="loading">로딩 중...</p>';

    try {
        const [summary, byLocation, byMonth] = await Promise.all([
            api.getStats(),
            api.getStatsByLocation(),
            api.getStatsByMonth(),
        ]);

        content.innerHTML = `
            <div class="stats-grid">
                <div class="stat-card">
                    <span class="stat-icon">🌱</span>
                    <span class="stat-value">${summary.totalPlants}</span>
                    <span class="stat-label">총 식물 수</span>
                </div>
                <div class="stat-card">
                    <span class="stat-icon">📍</span>
                    <span class="stat-value">${summary.totalLocations}</span>
                    <span class="stat-label">장소 수</span>
                </div>
                <div class="stat-card">
                    <span class="stat-icon">💰</span>
                    <span class="stat-value">${formatPrice(summary.totalInvestment)}</span>
                    <span class="stat-label">총 투자 금액</span>
                </div>
                <div class="stat-card">
                    <span class="stat-icon">📊</span>
                    <span class="stat-value">${formatPrice(summary.averagePrice)}</span>
                    <span class="stat-label">평균 가격</span>
                </div>
            </div>

            ${summary.mostExpensive ? `
                <div class="stat-highlight">
                    🏆 가장 비싼 식물: <strong>${escapeHtml(summary.mostExpensive.name)}</strong> (${formatPrice(summary.mostExpensive.price)}원)
                </div>
            ` : ''}

            <h4>📍 장소별 통계</h4>
            <div class="stat-table">
                ${byLocation.map(loc => `
                    <div class="stat-row">
                        <span>${escapeHtml(loc.locationName)}</span>
                        <span>${loc.plantCount}개 / ${formatPrice(loc.totalInvestment)}원</span>
                    </div>
                `).join('')}
            </div>

            ${byMonth.length > 0 ? `
                <h4>📅 월별 구입 현황</h4>
                <div class="stat-table">
                    ${byMonth.map(m => `
                        <div class="stat-row">
                            <span>${m.month}</span>
                            <span>${m.count}개 / ${formatPrice(m.totalSpent)}원</span>
                        </div>
                    `).join('')}
                </div>
            ` : ''}
        `;
    } catch (error) {
        content.innerHTML = `<div class="error-state">⚠️ 통계를 불러올 수 없습니다.<br>Python 서버(5000)가 실행 중인지 확인하세요.</div>`;
    }
}

// ============ 검색 ============

async function searchPlants(query) {
    if (!query.trim()) return;
    document.getElementById('modal-search').classList.add('active');
    const results = document.getElementById('search-results');
    results.innerHTML = '<p class="loading">검색 중...</p>';

    try {
        const plants = await api.searchPlants(query);
        if (plants.length === 0) {
            results.innerHTML = `<div class="empty-state"><p>검색 결과가 없습니다.</p></div>`;
            return;
        }
        results.innerHTML = plants.map(plant => `
            <div class="search-item" onclick="document.getElementById('modal-search').classList.remove('active'); openPlantDetail('${plant.id}');">
                <strong>${escapeHtml(plant.name)}</strong>
                ${plant.purchasePlace ? `<span class="search-place">📍 ${escapeHtml(plant.purchasePlace)}</span>` : ''}
                ${plant.price ? `<span class="search-price">${formatPrice(plant.price)}원</span>` : ''}
            </div>
        `).join('');
    } catch (error) {
        results.innerHTML = `<div class="error-state">⚠️ ${error.message}</div>`;
    }
}

// ============ 유틸 함수 ============

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
}

function escapeAttr(text) {
    return (text || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

function formatDate(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
}

function formatPrice(price) {
    if (!price && price !== 0) return '0';
    return Number(price).toLocaleString('ko-KR');
}

// ============ 인증/권한 관리 ============

let isAdmin = false; // 관리자 로그인 상태

async function loadAdminName() {
    const greetingEl = document.getElementById('admin-greeting');

    // 서버 모드일 때 관리자 정보 확인
    if (!useLocalStorage) {
        try {
            const res = await fetch('/api/auth/info');
            const info = await res.json();
            if (info.hasAdmin) {
                // 관리자가 설정된 상태
                if (isAdmin) {
                    greetingEl.textContent = `🧑‍🌾 ${info.adminName}님 (관리자)`;
                    greetingEl.classList.add('has-name');
                } else {
                    greetingEl.textContent = '🔒 로그인';
                    greetingEl.classList.remove('has-name');
                }
            } else {
                greetingEl.textContent = '⚙️ 관리자 설정';
                greetingEl.classList.remove('has-name');
            }
            updateEditPermission();
            return;
        } catch (e) {}
    }

    // 로컬 모드
    const name = localStorage.getItem('pd_admin_name');
    if (name) {
        // isAdmin은 로그인/세션복원에 의해서만 설정됨 (여기서 변경하지 않음)
        if (isAdmin) {
            greetingEl.textContent = `🧑‍🌾 ${name}님의 식물일기`;
            greetingEl.classList.add('has-name');
        } else {
            greetingEl.textContent = '🔒 로그인';
            greetingEl.classList.remove('has-name');
        }
    } else {
        greetingEl.textContent = '⚙️ 관리자 설정';
        greetingEl.classList.remove('has-name');
    }
    updateEditPermission();
}

function openAuthModal() {
    const modal = document.getElementById('modal-auth');
    const body = document.getElementById('auth-modal-body');
    const title = document.getElementById('auth-modal-title');

    if (isAdmin) {
        // 이미 로그인됨 → 로그아웃 옵션
        title.textContent = '👤 관리자 메뉴';
        body.innerHTML = `
            <p style="margin-bottom:16px;">현재 관리자로 로그인되어 있습니다.</p>
            <button class="btn btn-primary btn-full" onclick="logoutAdmin()" style="margin-bottom:8px;">🚪 로그아웃</button>
            <button class="btn btn-outline btn-full" onclick="openChangePassword()" style="border-color:var(--color-border);color:var(--color-text);">🔑 비밀번호 변경</button>
        `;
    } else {
        // 서버에 관리자가 설정되어 있는지 확인
        fetch('/api/auth/info')
            .then(r => r.json())
            .then(info => {
                if (info.hasAdmin) {
                    // 로그인 폼
                    title.textContent = '🔐 관리자 로그인';
                    body.innerHTML = `
                        <p style="margin-bottom:12px;">편집 권한을 위해 비밀번호를 입력하세요.</p>
                        <div class="form-group">
                            <label>비밀번호</label>
                            <input type="password" id="auth-password" placeholder="비밀번호 입력" class="sched-input">
                        </div>
                        <button class="btn btn-primary btn-full" onclick="loginAdmin()">로그인</button>
                        <p style="margin-top:12px; font-size:0.8rem; color:var(--color-text-secondary);">※ 로그인하지 않아도 정보를 볼 수 있습니다</p>
                    `;
                    setTimeout(() => document.getElementById('auth-password')?.focus(), 100);
                } else {
                    // 초기 설정 폼
                    title.textContent = '⚙️ 관리자 초기 설정';
                    body.innerHTML = `
                        <p style="margin-bottom:12px;">관리자 이름과 비밀번호를 설정하세요.<br>설정 후 다른 사람은 읽기만 가능합니다.</p>
                        <div class="form-group">
                            <label>관리자 이름</label>
                            <input type="text" id="auth-name" placeholder="예: 홍길동" class="sched-input" maxlength="20">
                        </div>
                        <div class="form-group">
                            <label>비밀번호</label>
                            <input type="password" id="auth-password" placeholder="비밀번호 설정" class="sched-input">
                        </div>
                        <div class="form-group">
                            <label>비밀번호 확인</label>
                            <input type="password" id="auth-password2" placeholder="비밀번호 다시 입력" class="sched-input">
                        </div>
                        <button class="btn btn-primary btn-full" onclick="setupAdmin()">설정 완료</button>
                    `;
                }
            })
            .catch(() => {
                // 로컬 모드
                const existingName = localStorage.getItem('pd_admin_name');
                const hasPassword = !!localStorage.getItem('pd_admin_pass');

                if (existingName && hasPassword) {
                    // 이미 등록됨 → 비밀번호 로그인
                    title.textContent = '🔐 관리자 로그인';
                    body.innerHTML = `
                        <p style="margin-bottom:12px;">편집 권한을 위해 비밀번호를 입력하세요.</p>
                        <div class="form-group">
                            <label>비밀번호</label>
                            <input type="password" id="auth-password" placeholder="비밀번호 입력" class="sched-input">
                        </div>
                        <button class="btn btn-primary btn-full" onclick="loginLocalAdmin()">로그인</button>
                        <p style="margin-top:12px; font-size:0.8rem; color:var(--color-text-secondary);">※ 로그인하지 않아도 정보를 볼 수 있습니다</p>
                    `;
                    setTimeout(() => document.getElementById('auth-password')?.focus(), 100);
                } else {
                    // 처음 등록 → 이름 + 비밀번호 설정
                    title.textContent = '⚙️ 관리자 초기 설정';
                    body.innerHTML = `
                        <p style="margin-bottom:12px;">관리자 이름과 비밀번호를 설정하세요.<br>설정 후 다른 사람은 읽기만 가능합니다.</p>
                        <div class="form-group">
                            <label>관리자 이름</label>
                            <input type="text" id="auth-name" placeholder="예: 홍길동" class="sched-input" maxlength="20">
                        </div>
                        <div class="form-group">
                            <label>비밀번호</label>
                            <input type="password" id="auth-password" placeholder="비밀번호 설정" class="sched-input">
                        </div>
                        <div class="form-group">
                            <label>비밀번호 확인</label>
                            <input type="password" id="auth-password2" placeholder="비밀번호 다시 입력" class="sched-input">
                        </div>
                        <button class="btn btn-primary btn-full" onclick="saveLocalAdmin()">설정 완료</button>
                    `;
                }
            });
    }

    modal.classList.add('active');
}

async function setupAdmin() {
    const name = document.getElementById('auth-name').value.trim();
    const pass = document.getElementById('auth-password').value;
    const pass2 = document.getElementById('auth-password2').value;

    if (!name) { alert('이름을 입력해주세요.'); return; }
    if (!pass) { alert('비밀번호를 입력해주세요.'); return; }
    if (pass !== pass2) { alert('비밀번호가 일치하지 않습니다.'); return; }
    if (pass.length < 4) { alert('비밀번호는 4자 이상으로 설정해주세요.'); return; }

    try {
        const res = await fetch('/api/auth/setup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, password: pass }),
        });
        if (res.ok) {
            isAdmin = true;
            document.getElementById('modal-auth').classList.remove('active');
            showBulkToast('✅ 관리자 설정 완료!');
            loadAdminName();
        } else {
            const err = await res.json();
            alert(err.error);
        }
    } catch (e) {
        alert('설정 실패: ' + e.message);
    }
}

async function loginAdmin() {
    const pass = document.getElementById('auth-password').value;
    if (!pass) { alert('비밀번호를 입력해주세요.'); return; }

    try {
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: pass }),
        });
        if (res.ok) {
            const data = await res.json();
            isAdmin = true;
            sessionStorage.setItem('pd_admin_logged', 'true');
            document.getElementById('modal-auth').classList.remove('active');
            showBulkToast(`🧑‍🌾 ${data.name}님 환영합니다!`);
            loadAdminName();
        } else {
            const err = await res.json();
            alert(err.error || '로그인 실패');
        }
    } catch (e) {
        alert('로그인 실패: ' + e.message);
    }
}

function logoutAdmin() {
    isAdmin = false;
    sessionStorage.removeItem('pd_admin_logged');
    document.getElementById('modal-auth').classList.remove('active');
    showBulkToast('🚪 로그아웃되었습니다. (읽기 전용 모드)');
    loadAdminName();
}

function openChangePassword() {
    const body = document.getElementById('auth-modal-body');
    document.getElementById('auth-modal-title').textContent = '🔑 비밀번호 변경';
    body.innerHTML = `
        <div class="form-group">
            <label>현재 비밀번호</label>
            <input type="password" id="auth-current-pass" class="sched-input">
        </div>
        <div class="form-group">
            <label>새 비밀번호</label>
            <input type="password" id="auth-new-pass" class="sched-input">
        </div>
        <div class="form-group">
            <label>새 비밀번호 확인</label>
            <input type="password" id="auth-new-pass2" class="sched-input">
        </div>
        <button class="btn btn-primary btn-full" onclick="changePassword()">변경</button>
    `;
}

async function changePassword() {
    const current = document.getElementById('auth-current-pass').value;
    const newPass = document.getElementById('auth-new-pass').value;
    const newPass2 = document.getElementById('auth-new-pass2').value;

    if (!current || !newPass) { alert('모든 필드를 입력해주세요.'); return; }
    if (newPass !== newPass2) { alert('새 비밀번호가 일치하지 않습니다.'); return; }
    if (newPass.length < 4) { alert('비밀번호는 4자 이상이어야 합니다.'); return; }

    // 로컬 모드
    if (storageMode === 'local' || storageMode === 'firebase' || storageMode === 'cloud') {
        const savedPass = localStorage.getItem('pd_admin_pass');
        if (current !== savedPass) { alert('현재 비밀번호가 틀렸습니다.'); return; }
        localStorage.setItem('pd_admin_pass', newPass);
        document.getElementById('modal-auth').classList.remove('active');
        showBulkToast('🔑 비밀번호가 변경되었습니다.');
        return;
    }

    // 서버 모드
    try {
        const res = await fetch('/api/auth/change-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ currentPassword: current, newPassword: newPass }),
        });
        if (res.ok) {
            document.getElementById('modal-auth').classList.remove('active');
            showBulkToast('🔑 비밀번호가 변경되었습니다.');
        } else {
            const err = await res.json();
            alert(err.error);
        }
    } catch (e) {
        alert('변경 실패: ' + e.message);
    }
}

function saveLocalAdmin() {
    const name = document.getElementById('auth-name').value.trim();
    const pass = document.getElementById('auth-password')?.value || '';
    const pass2 = document.getElementById('auth-password2')?.value || '';

    if (!name) { alert('이름을 입력해주세요.'); return; }
    if (!pass) { alert('비밀번호를 입력해주세요.'); return; }
    if (pass !== pass2) { alert('비밀번호가 일치하지 않습니다.'); return; }
    if (pass.length < 4) { alert('비밀번호는 4자 이상으로 설정해주세요.'); return; }

    localStorage.setItem('pd_admin_name', name);
    localStorage.setItem('pd_admin_pass', pass);
    isAdmin = true;
    sessionStorage.setItem('pd_admin_logged', 'true');
    document.getElementById('modal-auth').classList.remove('active');
    showBulkToast('✅ 관리자 설정 완료!');
    loadAdminName();
}

function loginLocalAdmin() {
    const pass = document.getElementById('auth-password').value;
    const savedPass = localStorage.getItem('pd_admin_pass');

    if (!pass) { alert('비밀번호를 입력해주세요.'); return; }
    if (pass !== savedPass) { alert('비밀번호가 틀렸습니다.'); return; }

    isAdmin = true;
    sessionStorage.setItem('pd_admin_logged', 'true');
    document.getElementById('modal-auth').classList.remove('active');
    const name = localStorage.getItem('pd_admin_name') || '관리자';
    showBulkToast(`🧑‍🌾 ${name}님 환영합니다!`);
    loadAdminName();
}

// 편집 권한 UI 업데이트: 관리자가 아니면 편집 버튼 숨김
function updateEditPermission() {
    const editButtons = document.querySelectorAll(
        '#btn-add-location, #btn-add-plant, #btn-add-shop, #btn-edit-plant, #btn-delete-plant, #btn-move-plant, #btn-dead-plant, .btn-bulk-care, .card-actions .btn-danger, .card-actions .btn-outline'
    );
    editButtons.forEach(btn => {
        if (btn) btn.style.display = isAdmin ? '' : 'none';
    });

    // 읽기 전용 배지 표시
    let badge = document.getElementById('readonly-badge');
    if (!isAdmin) {
        if (!badge) {
            badge = document.createElement('div');
            badge.id = 'readonly-badge';
            badge.className = 'readonly-badge';
            badge.textContent = '👁️ 읽기 전용 모드';
            document.querySelector('.main-content')?.prepend(badge);
        }
        badge.style.display = '';
    } else {
        if (badge) badge.style.display = 'none';
    }
}

// 세션 복원 (새로고침 시)
function restoreSession() {
    if (sessionStorage.getItem('pd_admin_logged') === 'true') {
        isAdmin = true;
    }
}

// ============ 클라우드 DB 설정 UI ============

function showCloudStatus() {
    let statusEl = document.getElementById('cloud-status');
    if (!statusEl) {
        statusEl = document.createElement('div');
        statusEl.id = 'cloud-status';
        const weatherEl = document.getElementById('weather-widget');
        if (weatherEl) weatherEl.after(statusEl);
        else document.querySelector('.main-content')?.prepend(statusEl);
    }

    if (storageMode === 'server') {
        statusEl.className = 'cloud-status connected';
        statusEl.innerHTML = '🖥️ 서버 연결됨 - 데이터가 서버에 저장됩니다';
    } else if (storageMode === 'firebase') {
        statusEl.className = 'cloud-status connected';
        statusEl.innerHTML = '🔥 Firebase 연결됨 - PC 꺼져도 어디서든 접속 가능';
    } else if (storageMode === 'cloud') {
        statusEl.className = 'cloud-status connected';
        statusEl.innerHTML = '☁️ 클라우드 연결됨 - PC가 꺼져도 데이터가 유지됩니다';
    } else {
        statusEl.className = 'cloud-status disconnected';
        statusEl.innerHTML = `📦 로컬 모드 - 이 기기에만 데이터 저장됨 <button class="btn btn-sm btn-primary" onclick="openCloudSetup()">☁️ 클라우드 연결</button>`;
    }
}

function openCloudSetup() {
    const config = getCloudConfig();
    const hasConfig = config && config.binId;

    const html = `
        <div class="modal active" id="modal-cloud" onclick="if(event.target===this)this.classList.remove('active')">
            <div class="modal-content">
                <div class="modal-header">
                    <h3>☁️ 클라우드 DB 설정</h3>
                    <button class="btn-close" onclick="document.getElementById('modal-cloud').remove()">&times;</button>
                </div>
                <div style="margin-bottom:16px;">
                    <p style="font-size:0.9rem; color:var(--color-text-secondary); margin-bottom:12px;">
                        무료 클라우드 저장소를 연결하면 PC가 꺼져도, 모바일에서도 데이터를 볼 수 있습니다.
                    </p>
                    <p style="font-size:0.85rem; margin-bottom:12px;">
                        <strong>설정 방법:</strong><br>
                        1. <a href="https://jsonbin.io" target="_blank">jsonbin.io</a> 에 무료 가입<br>
                        2. 로그인 후 API Keys 메뉴에서 키 복사<br>
                        3. 아래에 붙여넣기
                    </p>
                </div>
                <div class="form-group">
                    <label>API Key (Master Key)</label>
                    <input type="text" id="cloud-api-key" class="sched-input" placeholder="$2a$10$..." value="${hasConfig ? config.apiKey : ''}">
                </div>
                ${hasConfig ? `
                    <div class="form-group">
                        <label>Bin ID (자동 생성됨)</label>
                        <input type="text" id="cloud-bin-id" class="sched-input" value="${config.binId}" readonly>
                    </div>
                    <button class="btn btn-primary btn-full" onclick="testCloudConnection()">연결 테스트</button>
                    <button class="btn btn-full" style="margin-top:8px;border:1px solid var(--color-border);" onclick="disconnectCloud()">연결 해제</button>
                ` : `
                    <div class="form-group">
                        <label>Bin ID (있으면 입력, 없으면 비워두세요)</label>
                        <input type="text" id="cloud-bin-id" class="sched-input" placeholder="비워두면 새로 생성됩니다">
                    </div>
                    <button class="btn btn-primary btn-full" onclick="connectCloud()">연결하기</button>
                `}
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', html);
}

async function connectCloud() {
    const apiKey = document.getElementById('cloud-api-key').value.trim();
    const binId = document.getElementById('cloud-bin-id').value.trim();

    if (!apiKey) { alert('API Key를 입력해주세요.'); return; }

    let result;
    if (binId) {
        result = await connectCloudDB(apiKey, binId);
    } else {
        result = await setupCloudDB(apiKey);
    }

    if (result.success) {
        storageMode = 'cloud';
        document.getElementById('modal-cloud')?.remove();
        showCloudStatus();
        showBulkToast('☁️ 클라우드 연결 성공! 데이터가 공유됩니다.');
        await loadLocations();
    } else {
        alert('연결 실패: ' + (result.error || 'API Key를 확인해주세요.'));
    }
}

async function testCloudConnection() {
    const config = getCloudConfig();
    if (!config) return;
    try {
        const res = await fetch(`https://api.jsonbin.io/v3/b/${config.binId}/latest`, {
            headers: { 'X-Master-Key': config.apiKey },
            signal: AbortSignal.timeout(5000),
        });
        if (res.ok) {
            showBulkToast('✅ 클라우드 연결 정상!');
        } else {
            alert('연결 실패: 상태 ' + res.status);
        }
    } catch (e) {
        alert('연결 실패: ' + e.message);
    }
}

function disconnectCloud() {
    if (!confirm('클라우드 연결을 해제하시겠습니까?\n데이터는 클라우드에 남아있습니다.')) return;
    localStorage.removeItem('pd_cloud_config');
    storageMode = 'local';
    document.getElementById('modal-cloud')?.remove();
    showCloudStatus();
    showBulkToast('연결 해제됨 - 로컬 모드로 전환');
}

// ============ 날씨 위젯 ============

function loadWeather() {
    const widget = document.getElementById('weather-widget');

    // 위치 가져오기 (Geolocation API)
    if (!navigator.geolocation) {
        widget.innerHTML = getWeatherFallback();
        return;
    }

    navigator.geolocation.getCurrentPosition(
        async (position) => {
            const { latitude, longitude } = position.coords;
            try {
                await fetchWeatherData(latitude, longitude, widget);
            } catch (e) {
                // 위치 기반 실패 시 서울 기본값
                await fetchWeatherData(37.5665, 126.9780, widget);
            }
        },
        async () => {
            // 위치 권한 거부 시 서울 기본값
            await fetchWeatherData(37.5665, 126.9780, widget);
        },
        { timeout: 5000 }
    );
}

async function fetchWeatherData(lat, lon, widget) {
    try {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&timezone=Asia%2FSeoul`;
        const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
        if (!res.ok) throw new Error('날씨 API 오류');
        const data = await res.json();
        const current = data.current;

        const temp = Math.round(current.temperature_2m);
        const humidity = current.relative_humidity_2m;
        const windSpeed = current.wind_speed_10m;
        const weatherCode = current.weather_code;
        const weatherInfo = getWeatherDescription(weatherCode);

        // 식물 관리 팁
        const tip = getPlantTip(temp, humidity, weatherCode);

        widget.innerHTML = `
            <div class="weather-content">
                <div class="weather-icon">${weatherInfo.icon}</div>
                <div class="weather-main">
                    <div class="weather-temp">${temp}°C</div>
                    <div class="weather-desc">${weatherInfo.desc}</div>
                </div>
                <div class="weather-details">
                    <div class="weather-detail-item">
                        <span class="weather-detail-icon">💧</span>
                        <span class="weather-detail-value">${humidity}%</span>
                        <span class="weather-detail-label">습도</span>
                    </div>
                    <div class="weather-detail-item">
                        <span class="weather-detail-icon">🌬️</span>
                        <span class="weather-detail-value">${windSpeed}km/h</span>
                        <span class="weather-detail-label">바람</span>
                    </div>
                </div>
                <div class="weather-tip">
                    <span class="tip-icon">🌱</span>
                    <span class="tip-text">${tip}</span>
                </div>
            </div>
        `;
    } catch (e) {
        widget.innerHTML = getWeatherFallback();
    }
}

function getWeatherDescription(code) {
    const map = {
        0: { icon: '☀️', desc: '맑음' },
        1: { icon: '🌤️', desc: '대체로 맑음' },
        2: { icon: '⛅', desc: '부분 흐림' },
        3: { icon: '☁️', desc: '흐림' },
        45: { icon: '🌫️', desc: '안개' },
        48: { icon: '🌫️', desc: '짙은 안개' },
        51: { icon: '🌦️', desc: '가벼운 이슬비' },
        53: { icon: '🌦️', desc: '이슬비' },
        55: { icon: '🌦️', desc: '강한 이슬비' },
        61: { icon: '🌧️', desc: '약한 비' },
        63: { icon: '🌧️', desc: '비' },
        65: { icon: '🌧️', desc: '강한 비' },
        71: { icon: '🌨️', desc: '약한 눈' },
        73: { icon: '🌨️', desc: '눈' },
        75: { icon: '❄️', desc: '강한 눈' },
        77: { icon: '🌨️', desc: '싸락눈' },
        80: { icon: '🌧️', desc: '소나기' },
        81: { icon: '🌧️', desc: '강한 소나기' },
        82: { icon: '⛈️', desc: '폭우' },
        85: { icon: '🌨️', desc: '눈 소나기' },
        86: { icon: '❄️', desc: '강한 눈 소나기' },
        95: { icon: '⛈️', desc: '뇌우' },
        96: { icon: '⛈️', desc: '우박 동반 뇌우' },
        99: { icon: '⛈️', desc: '강한 우박 뇌우' },
    };
    return map[code] || { icon: '🌤️', desc: '날씨 정보' };
}

function getPlantTip(temp, humidity, weatherCode) {
    if (humidity < 40) return '습도가 낮아요! 잎에 분무해주면 좋아요.';
    if (humidity > 80) return '습도가 높아요. 통풍에 신경 써주세요.';
    if (temp > 35) return '너무 더워요! 직사광선을 피해주세요.';
    if (temp < 5) return '추위 주의! 실내로 들여놓으세요.';
    if (weatherCode >= 61 && weatherCode <= 67) return '비 오는 날, 실외 화분 과습 주의!';
    if (temp >= 20 && temp <= 28 && humidity >= 40 && humidity <= 70) return '식물이 자라기 좋은 날씨입니다! 🌿';
    if (temp >= 15 && temp < 20) return '선선한 날씨, 물주기 간격을 조금 늘려보세요.';
    return '오늘도 식물에게 관심을 가져주세요! 💚';
}

function getWeatherFallback() {
    return `
        <div class="weather-content weather-fallback">
            <span class="weather-icon">🌤️</span>
            <span>날씨 정보를 불러올 수 없습니다</span>
        </div>
    `;
}

// ============ 식물 장소 이동 ============

async function openMovePlantModal() {
    const plant = await api.getPlant(currentPlantId);
    if (!plant) return;

    const locations = await api.getLocations();
    const desc = document.getElementById('move-plant-desc');
    const list = document.getElementById('move-location-list');

    desc.textContent = `"${plant.name}"을(를) 어디로 이동할까요?`;

    // 현재 장소 제외한 목록 표시
    const otherLocations = locations.filter(loc => loc.id !== plant.locationId && loc.id !== currentLocationId);

    if (otherLocations.length === 0) {
        list.innerHTML = '<p class="move-empty">이동할 수 있는 다른 장소가 없습니다.<br>장소를 먼저 추가해주세요.</p>';
    } else {
        list.innerHTML = otherLocations.map(loc => `
            <div class="move-location-item" onclick="movePlantToLocation(${currentPlantId}, ${loc.id}, '${escapeAttr(loc.name)}')">
                <span class="move-loc-icon">📍</span>
                <span class="move-loc-name">${escapeHtml(loc.name)}</span>
                <span class="move-loc-count">${loc.plantCount || 0}개</span>
                <span class="move-loc-arrow">→</span>
            </div>
        `).join('');
    }

    document.getElementById('modal-move-plant').classList.add('active');
}

async function movePlantToLocation(plantId, newLocationId, locationName) {
    const plant = await api.getPlant(plantId);
    if (!plant) return;

    // locationId 업데이트 (모든 모드 통합)
    await api.updatePlant(plantId, { locationId: newLocationId });

    document.getElementById('modal-move-plant').classList.remove('active');
    showBulkToast(`📦 "${plant.name}"이(가) "${locationName}"으로 이동했습니다!`);

    // 식물 목록으로 돌아가기
    showView('plants');
    await loadPlants();
}

// ============ CSV 내보내기 (로컬 모드) ============

function exportCsvLocal() {
    const plants = localApi.getAllPlants();
    const locations = storage._get('pd_locations');
    const locationMap = {};
    locations.forEach(loc => { locationMap[loc.id] = loc.name; });

    // BOM + 헤더
    let csv = '\uFEFF';
    csv += '식물이름,장소,가격(원),구입날짜,구매처,메모,등록일\n';

    plants.forEach(plant => {
        const locName = locationMap[plant.locationId] || '';
        const row = [
            escapeCsvField(plant.name || ''),
            escapeCsvField(locName),
            plant.price || '',
            plant.purchaseDate || '',
            escapeCsvField(plant.purchasePlace || ''),
            escapeCsvField(plant.memo || ''),
            plant.createdAt ? plant.createdAt.split('T')[0] : '',
        ];
        csv += row.join(',') + '\n';
    });

    // 다운로드
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const today = new Date().toISOString().split('T')[0];
    a.download = `plant_diary_${today}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showBulkToast('📥 CSV 파일이 다운로드되었습니다!');
}

function escapeCsvField(text) {
    if (!text) return '';
    if (text.includes(',') || text.includes('"') || text.includes('\n')) {
        return '"' + text.replace(/"/g, '""') + '"';
    }
    return text;
}

// ============ 식물업체 관리 ============

function getShops() {
    const data = localStorage.getItem('pd_shops');
    return data ? JSON.parse(data) : [];
}

function saveShops(shops) {
    localStorage.setItem('pd_shops', JSON.stringify(shops));
}

function addShop(data) {
    const shops = getShops();
    const id = parseInt(localStorage.getItem('pd_shops_id') || '0') + 1;
    localStorage.setItem('pd_shops_id', String(id));
    shops.push({ id, ...data, createdAt: new Date().toISOString() });
    saveShops(shops);
}

function updateShop(id, data) {
    const shops = getShops();
    const index = shops.findIndex(s => s.id === id);
    if (index !== -1) {
        shops[index] = { ...shops[index], ...data };
        saveShops(shops);
    }
}

function deleteShop(id) {
    let shops = getShops();
    shops = shops.filter(s => s.id !== id);
    saveShops(shops);
}

function getCategoryLabel(cat) {
    const map = {
        'flower-market': '🌸 꽃시장',
        'garden-center': '🏡 가든센터',
        'online': '🛒 온라인',
        'nursery': '🌳 농원/화원',
        'interior': '🪴 플랜테리어샵',
        'other': '📦 기타',
    };
    return map[cat] || cat;
}

function renderStars(rating) {
    let stars = '';
    for (let i = 1; i <= 5; i++) {
        stars += i <= rating ? '★' : '☆';
    }
    return `<span class="shop-stars">${stars}</span>`;
}

function updateStarDisplay(value) {
    document.querySelectorAll('#shop-rating-input .star').forEach(star => {
        const v = parseInt(star.dataset.value);
        star.textContent = v <= value ? '★' : '☆';
        star.classList.toggle('active', v <= value);
    });
}

function loadShops() {
    const list = document.getElementById('shop-list');
    const shops = getShops();

    if (shops.length === 0) {
        list.innerHTML = `
            <div class="empty-state">
                <span class="empty-icon">🏪</span>
                <h3>등록된 업체가 없어요</h3>
                <p>+ 업체 추가 버튼을 눌러 자주 가는 식물업체를 등록해보세요</p>
            </div>
        `;
        return;
    }

    list.innerHTML = shops.map(shop => `
        <div class="shop-card" data-id="${shop.id}">
            <div class="shop-card-header">
                <div class="shop-card-title">
                    <h3>${escapeHtml(shop.name)}</h3>
                    <span class="shop-category-badge">${getCategoryLabel(shop.category)}</span>
                </div>
                ${shop.rating ? renderStars(shop.rating) : ''}
            </div>
            <div class="shop-card-body">
                ${shop.address ? `<p class="shop-info-row">📍 ${escapeHtml(shop.address)}</p>` : ''}
                ${shop.phone ? `<p class="shop-info-row">📞 <a href="tel:${escapeAttr(shop.phone)}">${escapeHtml(shop.phone)}</a></p>` : ''}
                ${shop.url ? `<p class="shop-info-row">🔗 <a href="${escapeAttr(shop.url)}" target="_blank" rel="noopener">${escapeHtml(shop.url.replace(/^https?:\/\//, ''))}</a></p>` : ''}
                ${shop.hours ? `<p class="shop-info-row">🕐 ${escapeHtml(shop.hours)}</p>` : ''}
                ${shop.memo ? `<p class="shop-memo">${escapeHtml(shop.memo)}</p>` : ''}
            </div>
            <div class="shop-card-actions">
                <button class="btn btn-sm btn-outline" onclick="editShop(${shop.id})">수정</button>
                <button class="btn btn-sm btn-danger" onclick="removeShop(${shop.id}, '${escapeAttr(shop.name)}')">삭제</button>
                ${shop.address ? `<button class="btn btn-sm btn-outline" onclick="openMap('${escapeAttr(shop.address)}')">🗺️ 지도</button>` : ''}
            </div>
        </div>
    `).join('');
}

function openShopModal(shop = null) {
    document.getElementById('shop-id').value = shop ? shop.id : '';
    document.getElementById('shop-name').value = shop ? shop.name : '';
    document.getElementById('shop-category').value = shop ? shop.category : 'flower-market';
    document.getElementById('shop-address').value = shop ? (shop.address || '') : '';
    document.getElementById('shop-phone').value = shop ? (shop.phone || '') : '';
    document.getElementById('shop-url').value = shop ? (shop.url || '') : '';
    document.getElementById('shop-hours').value = shop ? (shop.hours || '') : '';
    document.getElementById('shop-memo').value = shop ? (shop.memo || '') : '';
    document.getElementById('shop-rating').value = shop ? (shop.rating || 0) : 0;
    document.getElementById('modal-shop-title').textContent = shop ? '업체 수정' : '업체 추가';

    updateStarDisplay(shop ? (shop.rating || 0) : 0);
    document.getElementById('modal-shop').classList.add('active');
}

function editShop(id) {
    const shops = getShops();
    const shop = shops.find(s => s.id === id);
    if (shop) openShopModal(shop);
}

function removeShop(id, name) {
    if (!confirm(`"${name}" 업체를 삭제하시겠습니까?`)) return;
    deleteShop(id);
    loadShops();
}

function openMap(address) {
    const encoded = encodeURIComponent(address);
    window.open(`https://map.naver.com/v5/search/${encoded}`, '_blank');
}

// ============ 이벤트 리스너 ============

document.addEventListener('DOMContentLoaded', async () => {
    try {
        restoreSession();
        await checkBackend();
    } catch (e) {
        console.warn('초기화 오류 (무시하고 계속):', e);
        storageMode = 'local';
    }

    try { loadAdminName(); } catch(e) { console.warn('관리자 로드 실패:', e); }
    try { loadWeather(); } catch(e) { console.warn('날씨 로드 실패:', e); }
    try { checkAllSchedules(); } catch(e) { console.warn('스케줄 체크 실패:', e); }
    try { await loadLocations(); } catch(e) { console.warn('장소 로드 실패:', e); }
    try { showCloudStatus(); } catch(e) { console.warn('상태 표시 실패:', e); }

    // 장소 추가 버튼
    document.getElementById('btn-add-location').addEventListener('click', () => openLocationModal());

    // 장소 폼 제출
    document.getElementById('form-location').addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('location-id').value;
        const data = {
            name: document.getElementById('location-name').value.trim(),
            description: document.getElementById('location-desc').value.trim() || null,
        };

        try {
            if (id) {
                await api.updateLocation(id, data);
            } else {
                await api.createLocation(data);
            }
            document.getElementById('modal-location').classList.remove('active');
            await loadLocations();
        } catch (error) {
            alert(error.message);
        }
    });

    // 장소 모달 닫기
    document.getElementById('btn-close-location').addEventListener('click', () => {
        document.getElementById('modal-location').classList.remove('active');
    });

    // 식물 추가 버튼
    document.getElementById('btn-add-plant').addEventListener('click', () => openPlantModal());

    // 식물 폼 제출
    document.getElementById('form-plant').addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('plant-id').value;
        const data = {
            name: document.getElementById('plant-name').value.trim(),
            price: document.getElementById('plant-price').value ? parseInt(document.getElementById('plant-price').value) : null,
            purchaseDate: document.getElementById('plant-date').value || null,
            purchasePlace: document.getElementById('plant-place').value.trim() || null,
            memo: document.getElementById('plant-memo').value.trim() || null,
            imageUrl: document.getElementById('plant-image-url').value || null,
        };

        try {
            if (id) {
                await api.updatePlant(id, data);
                document.getElementById('modal-plant').classList.remove('active');
                // 수정 후 상세 페이지 갱신
                await openPlantDetail(id);
            } else {
                await api.createPlant(data, currentLocationId);
                document.getElementById('modal-plant').classList.remove('active');
                await loadPlants();
            }
        } catch (error) {
            alert(error.message);
        }
    });

    // 식물 모달 닫기
    document.getElementById('btn-close-plant').addEventListener('click', () => {
        document.getElementById('modal-plant').classList.remove('active');
    });

    // 이미지 업로드 (갤러리)
    document.getElementById('image-upload-area').addEventListener('click', () => {
        document.getElementById('plant-image-input').click();
    });

    document.getElementById('plant-image-input').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        try {
            const result = await api.uploadImage(file);
            document.getElementById('plant-image-url').value = result.imageUrl;
            const preview = document.getElementById('plant-image-preview');
            preview.src = api.getImageUrl(result.imageUrl);
            preview.classList.remove('hidden');
            document.getElementById('image-placeholder').classList.add('hidden');
        } catch (error) {
            alert('이미지 업로드 실패: ' + error.message);
        }
    });

    // 카메라 촬영
    document.getElementById('btn-camera-capture').addEventListener('click', () => {
        document.getElementById('plant-camera-input').click();
    });

    document.getElementById('plant-camera-input').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        try {
            const result = await api.uploadImage(file);
            document.getElementById('plant-image-url').value = result.imageUrl;
            const preview = document.getElementById('plant-image-preview');
            preview.src = api.getImageUrl(result.imageUrl);
            preview.classList.remove('hidden');
            document.getElementById('image-placeholder').classList.add('hidden');
        } catch (error) {
            alert('사진 촬영 업로드 실패: ' + error.message);
        }
    });

    // 뒤로가기 버튼
    document.getElementById('btn-back-locations').addEventListener('click', () => {
        showView('locations');
        loadLocations();
    });

    document.getElementById('btn-back-plants').addEventListener('click', () => {
        showView('plants');
    });

    // 식물 이동/수정/삭제
    document.getElementById('btn-move-plant').addEventListener('click', () => {
        openMovePlantModal();
    });

    document.getElementById('btn-close-move').addEventListener('click', () => {
        document.getElementById('modal-move-plant').classList.remove('active');
    });

    document.getElementById('btn-edit-plant').addEventListener('click', async () => {
        const plant = await api.getPlant(currentPlantId);
        openPlantModal(plant);
    });

    document.getElementById('btn-delete-plant').addEventListener('click', async () => {
        if (!confirm('이 식물을 삭제하시겠습니까?')) return;
        try {
            await api.deletePlant(currentPlantId);
            showView('plants');
            await loadPlants();
        } catch (error) {
            alert(error.message);
        }
    });

    // 고사 처리
    document.getElementById('btn-dead-plant').addEventListener('click', async () => {
        const plant = await api.getPlant(currentPlantId);
        if (!plant) return;

        if (plant.isDead) {
            // 이미 고사 상태 → 회생
            if (!confirm(`"${plant.name}"을(를) 회생시키겠습니까?`)) return;
            await api.updatePlant(currentPlantId, { isDead: false, deadDate: null });
            showBulkToast('🌱 회생되었습니다! 다시 관리할 수 있습니다.');
        } else {
            // 고사 처리
            if (!confirm(`"${plant.name}"을(를) 고사 처리하시겠습니까?\n(상세 내용이 비활성화됩니다)`)) return;
            await api.updatePlant(currentPlantId, { isDead: true, deadDate: new Date().toISOString().split('T')[0] });
            showBulkToast('💀 고사 처리되었습니다.');
        }
        await openPlantDetail(currentPlantId);
    });

    // 통계
    document.getElementById('btn-stats').addEventListener('click', showStats);
    document.getElementById('btn-close-stats').addEventListener('click', () => {
        document.getElementById('modal-stats').classList.remove('active');
    });

    // CSV 내보내기
    document.getElementById('btn-export').addEventListener('click', () => {
        if (useLocalStorage) {
            exportCsvLocal();
        } else {
            window.open(api.getExportUrl(), '_blank');
        }
    });

    // 검색
    document.getElementById('btn-search').addEventListener('click', () => {
        const query = document.getElementById('search-input').value;
        searchPlants(query);
    });

    document.getElementById('search-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            searchPlants(e.target.value);
        }
    });

    document.getElementById('btn-close-search').addEventListener('click', () => {
        document.getElementById('modal-search').classList.remove('active');
    });

    // 모달 외부 클릭 닫기
    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.classList.remove('active');
            }
        });
    });

    // 인증 모달 닫기
    document.getElementById('btn-close-auth').addEventListener('click', () => {
        document.getElementById('modal-auth').classList.remove('active');
    });

    // ============ 업체 페이지 이벤트 ============

    // 업체 페이지 열기
    document.getElementById('btn-shops').addEventListener('click', () => {
        showView('shops');
        loadShops();
    });

    // 메인으로 돌아가기
    document.getElementById('btn-back-from-shops').addEventListener('click', () => {
        showView('locations');
        loadLocations();
    });

    // 업체 추가 버튼
    document.getElementById('btn-add-shop').addEventListener('click', () => openShopModal());

    // 업체 모달 닫기
    document.getElementById('btn-close-shop').addEventListener('click', () => {
        document.getElementById('modal-shop').classList.remove('active');
    });

    // 별점 입력
    document.querySelectorAll('#shop-rating-input .star').forEach(star => {
        star.addEventListener('click', () => {
            const value = parseInt(star.dataset.value);
            document.getElementById('shop-rating').value = value;
            updateStarDisplay(value);
        });
    });

    // 업체 폼 제출
    document.getElementById('form-shop').addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('shop-id').value;
        const data = {
            name: document.getElementById('shop-name').value.trim(),
            category: document.getElementById('shop-category').value,
            address: document.getElementById('shop-address').value.trim() || null,
            phone: document.getElementById('shop-phone').value.trim() || null,
            url: document.getElementById('shop-url').value.trim() || null,
            hours: document.getElementById('shop-hours').value.trim() || null,
            memo: document.getElementById('shop-memo').value.trim() || null,
            rating: parseInt(document.getElementById('shop-rating').value) || 0,
        };

        if (id) {
            updateShop(parseInt(id), data);
        } else {
            addShop(data);
        }
        document.getElementById('modal-shop').classList.remove('active');
        loadShops();
    });
});
