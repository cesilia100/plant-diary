/**
 * Plant Diary - API 모듈
 * 
 * 데이터 저장 우선순위:
 * 1. Python 서버 연결 시 → 서버 API (같은 네트워크 공유)
 * 2. 서버 없을 때 → 클라우드 DB (인터넷만 되면 어디서든 공유, PC 꺼져도 유지)
 * 3. 인터넷도 없을 때 → LocalStorage (해당 기기에만 저장)
 */

// AbortSignal.timeout 폴리필 (구형 브라우저 지원)
if (!AbortSignal.timeout) {
    AbortSignal.timeout = function(ms) {
        const controller = new AbortController();
        setTimeout(() => controller.abort(), ms);
        return controller.signal;
    };
}

// ============ 설정 ============
const API_BASE = '/api';
const PYTHON_API = '/api';

// 클라우드 저장소 설정 (localStorage에 저장)
// 사용자가 처음 한 번만 설정하면 됨
function getCloudConfig() {
    const config = localStorage.getItem('pd_cloud_config');
    return config ? JSON.parse(config) : null;
}

function setCloudConfig(config) {
    localStorage.setItem('pd_cloud_config', JSON.stringify(config));
}

// 저장 모드: 'server' | 'firebase' | 'cloud' | 'local'
let storageMode = 'local';

// 시작 시 연결 확인
async function checkBackend() {
    // 1. Python 서버 체크 (file:// 프로토콜이면 스킵)
    if (window.location.protocol !== 'file:') {
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 2000);
            const res = await fetch(`${API_BASE}/health`, { signal: controller.signal });
            clearTimeout(timeout);
            if (res.ok) {
                storageMode = 'server';
                console.log('✅ 서버 연결됨 - 서버 모드');
                await syncLocalToServer();
                return;
            }
        } catch (e) {}
    }

    // 2. Firebase 체크
    if (typeof firebaseDb !== 'undefined' && firebaseDb.init()) {
        try {
            await firebaseDb.get('_health');
            storageMode = 'firebase';
            console.log('🔥 Firebase 연결됨 - 클라우드 모드 (PC 꺼져도 OK)');
            return;
        } catch (e) {
            // Firebase 연결 가능하지만 첫 접속(데이터 없음)일 수 있음
            try {
                await firebaseDb.set('_health', { connected: true, lastCheck: new Date().toISOString() });
                storageMode = 'firebase';
                console.log('🔥 Firebase 연결됨 - 초기화 완료');
                return;
            } catch (e2) {}
        }
    }

    // 3. JSONBin 클라우드 체크
    const cloudConfig = getCloudConfig();
    if (cloudConfig && cloudConfig.binId) {
        try {
            const testRes = await fetch(`https://api.jsonbin.io/v3/b/${cloudConfig.binId}/latest`, {
                headers: { 'X-Master-Key': cloudConfig.apiKey },
                signal: AbortSignal.timeout(5000),
            });
            if (testRes.ok) {
                storageMode = 'cloud';
                console.log('☁️ JSONBin 클라우드 연결됨');
                await syncLocalToCloud();
                return;
            }
        } catch (e) {}
    }

    // 4. 로컬 모드
    storageMode = 'local';
    console.log('📦 로컬 저장소 모드');
}

// useLocalStorage 호환 (기존 코드와의 호환을 위해)
Object.defineProperty(window, 'useLocalStorage', {
    get() { return storageMode === 'local'; }
});

// ============ 클라우드 DB (JSONBin.io) ============

async function cloudLoad() {
    const config = getCloudConfig();
    if (!config) return { locations: [], plants: [], careRecords: [] };
    try {
        const res = await fetch(`https://api.jsonbin.io/v3/b/${config.binId}/latest`, {
            headers: { 'X-Master-Key': config.apiKey },
        });
        if (!res.ok) throw new Error('클라우드 로드 실패');
        const json = await res.json();
        return json.record || { locations: [], plants: [], careRecords: [] };
    } catch (e) {
        console.warn('클라우드 로드 실패:', e);
        return { locations: [], plants: [], careRecords: [] };
    }
}

async function cloudSave(data) {
    const config = getCloudConfig();
    if (!config) return;
    try {
        await fetch(`https://api.jsonbin.io/v3/b/${config.binId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'X-Master-Key': config.apiKey,
            },
            body: JSON.stringify(data),
        });
    } catch (e) {
        console.warn('클라우드 저장 실패:', e);
    }
}

// 클라우드 DB 초기 설정
async function setupCloudDB(apiKey) {
    try {
        // 새 Bin 생성
        const res = await fetch('https://api.jsonbin.io/v3/b', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Master-Key': apiKey,
            },
            body: JSON.stringify({ locations: [], plants: [], careRecords: [], shops: [] }),
        });
        if (!res.ok) throw new Error('Bin 생성 실패');
        const json = await res.json();
        const binId = json.metadata.id;

        setCloudConfig({ apiKey, binId });

        // 기존 로컬 데이터를 클라우드로 이전
        await syncLocalToCloud();

        return { success: true, binId };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

// 기존 Bin ID로 연결
async function connectCloudDB(apiKey, binId) {
    try {
        const res = await fetch(`https://api.jsonbin.io/v3/b/${binId}/latest`, {
            headers: { 'X-Master-Key': apiKey },
            signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) throw new Error('Bin 연결 실패');

        setCloudConfig({ apiKey, binId });
        storageMode = 'cloud';
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

// 로컬 → 클라우드 동기화
async function syncLocalToCloud() {
    const localLocations = storage._get('pd_locations');
    const localPlants = storage._get('pd_plants');
    const localCare = storage._get('pd_care_records');

    if (localLocations.length === 0 && localPlants.length === 0) return;

    const cloudData = await cloudLoad();
    // 병합 (로컬 데이터 추가)
    const existingLocNames = new Set(cloudData.locations.map(l => l.name));
    localLocations.forEach(loc => {
        if (!existingLocNames.has(loc.name)) {
            cloudData.locations.push(loc);
        }
    });

    const existingPlants = new Set(cloudData.plants.map(p => `${p.name}_${p.locationId}`));
    localPlants.forEach(plant => {
        if (!existingPlants.has(`${plant.name}_${plant.locationId}`)) {
            cloudData.plants.push(plant);
        }
    });

    if (localCare.length > 0 && (!cloudData.careRecords || cloudData.careRecords.length === 0)) {
        cloudData.careRecords = localCare;
    }

    await cloudSave(cloudData);

    // 로컬 정리
    localStorage.removeItem('pd_locations');
    localStorage.removeItem('pd_plants');
    localStorage.removeItem('pd_care_records');
    console.log('🔄 로컬 → 클라우드 동기화 완료');
}

// 로컬 → 서버 동기화
async function syncLocalToServer() {
    const localLocations = storage._get('pd_locations');
    const localPlants = storage._get('pd_plants');

    if (localLocations.length === 0 && localPlants.length === 0) return;

    try {
        await fetch(`${API_BASE}/sync/import`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ locations: localLocations, plants: localPlants }),
        });
        localStorage.removeItem('pd_locations');
        localStorage.removeItem('pd_plants');
        localStorage.removeItem('pd_locations_id');
        localStorage.removeItem('pd_plants_id');
        console.log('🔄 로컬 → 서버 동기화 완료');
    } catch (e) {
        console.log('동기화 실패');
    }
}

// ============ 클라우드 API (JSONBin 기반 CRUD) ============

const cloudApi = {
    async getLocations() {
        const data = await cloudLoad();
        const locations = data.locations || [];
        const plants = data.plants || [];
        return locations.map(loc => ({
            ...loc,
            plantCount: plants.filter(p => p.locationId === loc.id).length,
        })).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    },

    async getLocation(id) {
        const data = await cloudLoad();
        return (data.locations || []).find(l => l.id === parseInt(id));
    },

    async createLocation(locData) {
        const data = await cloudLoad();
        if (!data.locations) data.locations = [];
        const maxId = data.locations.reduce((max, l) => Math.max(max, l.id || 0), 0);
        const newLoc = { id: maxId + 1, ...locData, createdAt: new Date().toISOString() };
        data.locations.push(newLoc);
        await cloudSave(data);
        return newLoc;
    },

    async updateLocation(id, locData) {
        const data = await cloudLoad();
        const idx = (data.locations || []).findIndex(l => l.id === parseInt(id));
        if (idx === -1) throw new Error('장소를 찾을 수 없습니다');
        data.locations[idx] = { ...data.locations[idx], ...locData };
        await cloudSave(data);
        return data.locations[idx];
    },

    async deleteLocation(id) {
        const data = await cloudLoad();
        const locId = parseInt(id);
        data.locations = (data.locations || []).filter(l => l.id !== locId);
        data.plants = (data.plants || []).filter(p => p.locationId !== locId);
        await cloudSave(data);
    },

    async getPlantsByLocation(locationId) {
        const data = await cloudLoad();
        return (data.plants || []).filter(p => p.locationId === parseInt(locationId))
            .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    },

    async getPlant(id) {
        const data = await cloudLoad();
        return (data.plants || []).find(p => p.id === parseInt(id));
    },

    async createPlant(plantData, locationId) {
        const data = await cloudLoad();
        if (!data.plants) data.plants = [];
        const maxId = data.plants.reduce((max, p) => Math.max(max, p.id || 0), 0);
        const newPlant = { id: maxId + 1, locationId: parseInt(locationId), ...plantData, createdAt: new Date().toISOString() };
        data.plants.push(newPlant);
        await cloudSave(data);
        return newPlant;
    },

    async updatePlant(id, plantData) {
        const data = await cloudLoad();
        const idx = (data.plants || []).findIndex(p => p.id === parseInt(id));
        if (idx === -1) throw new Error('식물을 찾을 수 없습니다');
        for (const key of Object.keys(plantData)) {
            if (plantData[key] !== undefined) data.plants[idx][key] = plantData[key];
        }
        await cloudSave(data);
        return data.plants[idx];
    },

    async deletePlant(id) {
        const data = await cloudLoad();
        const plantId = parseInt(id);
        data.plants = (data.plants || []).filter(p => p.id !== plantId);
        data.careRecords = (data.careRecords || []).filter(r => r.plantId !== plantId);
        await cloudSave(data);
    },

    async uploadImage(file) {
        // 클라우드 모드에서는 base64로 저장
        const dataUrl = await compressImage(file, 800, 0.7);
        return { imageUrl: dataUrl };
    },

    async getCareRecords(plantId) {
        const data = await cloudLoad();
        return (data.careRecords || []).filter(r => r.plantId === parseInt(plantId));
    },

    async getCareRecordsByMonth(plantId, year, month) {
        const records = await this.getCareRecords(plantId);
        const prefix = `${year}-${String(month).padStart(2, '0')}`;
        return records.filter(r => (r.date || '').startsWith(prefix));
    },

    async addCareRecord(plantId, record) {
        const data = await cloudLoad();
        if (!data.careRecords) data.careRecords = [];
        const maxId = data.careRecords.reduce((max, r) => Math.max(max, r.id || 0), 0);
        const newRecord = { id: maxId + 1, plantId: parseInt(plantId), ...record, createdAt: new Date().toISOString() };
        data.careRecords.push(newRecord);
        await cloudSave(data);
        return newRecord;
    },

    async deleteCareRecord(recordId) {
        const data = await cloudLoad();
        data.careRecords = (data.careRecords || []).filter(r => r.id !== parseInt(recordId));
        await cloudSave(data);
    },

    async deleteCareRecords(recordIds) {
        const data = await cloudLoad();
        const idsSet = new Set(recordIds.map(id => parseInt(id)));
        data.careRecords = (data.careRecords || []).filter(r => !idsSet.has(r.id));
        await cloudSave(data);
    },

    async updateCareRecord(recordId, updates) {
        const data = await cloudLoad();
        const idx = (data.careRecords || []).findIndex(r => r.id === parseInt(recordId));
        if (idx !== -1) {
            for (const key of Object.keys(updates)) {
                if (updates[key] !== undefined) data.careRecords[idx][key] = updates[key];
            }
            await cloudSave(data);
            return data.careRecords[idx];
        }
        return null;
    },

    async getStats() {
        const data = await cloudLoad();
        const plants = data.plants || [];
        const locations = data.locations || [];
        const totalPlants = plants.length;
        const totalLocations = locations.length;
        const totalInvestment = plants.reduce((s, p) => s + (p.price || 0), 0);
        const prices = plants.filter(p => p.price).map(p => p.price);
        const avgPrice = prices.length ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : 0;
        const mostExpensive = plants.filter(p => p.price).sort((a, b) => b.price - a.price)[0];
        return {
            totalPlants, totalLocations, totalInvestment, averagePrice: avgPrice,
            mostExpensive: mostExpensive ? { name: mostExpensive.name, price: mostExpensive.price } : null,
        };
    },

    async getStatsByLocation() {
        const data = await cloudLoad();
        return (data.locations || []).map(loc => {
            const locPlants = (data.plants || []).filter(p => p.locationId === loc.id);
            return {
                locationId: loc.id, locationName: loc.name,
                plantCount: locPlants.length,
                totalInvestment: locPlants.reduce((s, p) => s + (p.price || 0), 0),
            };
        }).sort((a, b) => b.plantCount - a.plantCount);
    },

    async getStatsByMonth() {
        const data = await cloudLoad();
        const monthly = {};
        (data.plants || []).forEach(p => {
            if (p.purchaseDate) {
                const key = p.purchaseDate.substring(0, 7);
                if (!monthly[key]) monthly[key] = { count: 0, totalSpent: 0 };
                monthly[key].count++;
                monthly[key].totalSpent += p.price || 0;
            }
        });
        return Object.entries(monthly).map(([month, d]) => ({ month, ...d })).sort((a, b) => a.month.localeCompare(b.month));
    },

    async searchPlants(query) {
        const data = await cloudLoad();
        const q = query.toLowerCase();
        return (data.plants || []).filter(p =>
            (p.name || '').toLowerCase().includes(q) ||
            (p.purchasePlace || '').toLowerCase().includes(q) ||
            (p.memo || '').toLowerCase().includes(q)
        );
    },
};

// ============ LocalStorage 헬퍼 ============

const storage = {
    _get(key) {
        const data = localStorage.getItem(key);
        return data ? JSON.parse(data) : [];
    },
    _set(key, data) {
        localStorage.setItem(key, JSON.stringify(data));
    },
    _nextId(key) {
        const counter = parseInt(localStorage.getItem(key + '_id') || '0') + 1;
        localStorage.setItem(key + '_id', String(counter));
        return counter;
    }
};

// ============ LocalStorage 기반 API ============

const localApi = {
    getLocations() {
        const locations = storage._get('pd_locations');
        return locations.map(loc => {
            const plants = storage._get('pd_plants').filter(p => p.locationId === loc.id);
            return { ...loc, plantCount: plants.length };
        }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    },

    getLocation(id) {
        const locations = storage._get('pd_locations');
        const locId = parseInt(id);
        return locations.find(l => l.id === locId);
    },

    createLocation(data) {
        const locations = storage._get('pd_locations');
        const newLoc = {
            id: storage._nextId('pd_locations'),
            name: data.name,
            description: data.description || null,
            createdAt: new Date().toISOString(),
        };
        locations.push(newLoc);
        storage._set('pd_locations', locations);
        return newLoc;
    },

    updateLocation(id, data) {
        const locations = storage._get('pd_locations');
        const locId = parseInt(id);
        const index = locations.findIndex(l => l.id === locId);
        if (index === -1) throw new Error('장소를 찾을 수 없습니다');
        locations[index] = { ...locations[index], name: data.name, description: data.description };
        storage._set('pd_locations', locations);
        return locations[index];
    },

    deleteLocation(id) {
        let locations = storage._get('pd_locations');
        const locId = parseInt(id);
        locations = locations.filter(l => l.id !== locId);
        storage._set('pd_locations', locations);
        // 해당 장소의 식물도 삭제
        let plants = storage._get('pd_plants');
        plants = plants.filter(p => p.locationId !== locId);
        storage._set('pd_plants', plants);
    },

    getPlantsByLocation(locationId) {
        const plants = storage._get('pd_plants');
        const locId = parseInt(locationId);
        return plants.filter(p => p.locationId === locId)
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    },

    getPlant(id) {
        const plants = storage._get('pd_plants');
        const plantId = parseInt(id);
        return plants.find(p => p.id === plantId);
    },

    createPlant(data, locationId) {
        const plants = storage._get('pd_plants');
        const newPlant = {
            id: storage._nextId('pd_plants'),
            locationId: parseInt(locationId),
            name: data.name,
            imageUrl: data.imageUrl || null,
            price: data.price || null,
            purchaseDate: data.purchaseDate || null,
            purchasePlace: data.purchasePlace || null,
            memo: data.memo || null,
            createdAt: new Date().toISOString(),
        };
        plants.push(newPlant);
        storage._set('pd_plants', plants);
        return newPlant;
    },

    updatePlant(id, data) {
        const plants = storage._get('pd_plants');
        const plantId = parseInt(id);
        const index = plants.findIndex(p => p.id === plantId);
        if (index === -1) throw new Error('식물을 찾을 수 없습니다');
        plants[index] = {
            ...plants[index],
            name: data.name !== undefined ? data.name : plants[index].name,
            imageUrl: data.imageUrl !== undefined ? (data.imageUrl || plants[index].imageUrl) : plants[index].imageUrl,
            price: data.price !== undefined ? data.price : plants[index].price,
            purchaseDate: data.purchaseDate !== undefined ? data.purchaseDate : plants[index].purchaseDate,
            purchasePlace: data.purchasePlace !== undefined ? data.purchasePlace : plants[index].purchasePlace,
            memo: data.memo !== undefined ? data.memo : plants[index].memo,
            locationId: data.locationId !== undefined ? parseInt(data.locationId) : plants[index].locationId,
            isDead: data.isDead !== undefined ? data.isDead : plants[index].isDead,
            deadDate: data.deadDate !== undefined ? data.deadDate : plants[index].deadDate,
        };
        storage._set('pd_plants', plants);
        return plants[index];
    },

    deletePlant(id) {
        let plants = storage._get('pd_plants');
        const plantId = parseInt(id);
        plants = plants.filter(p => p.id !== plantId);
        storage._set('pd_plants', plants);
    },

    // ============ 식물 케어 기록 ============

    getCareRecords(plantId) {
        const records = storage._get('pd_care_records');
        const pid = parseInt(plantId);
        return records.filter(r => r.plantId === pid)
            .sort((a, b) => b.date.localeCompare(a.date));
    },

    addCareRecord(plantId, record) {
        const records = storage._get('pd_care_records');
        const newRecord = {
            id: storage._nextId('pd_care_records'),
            plantId: parseInt(plantId),
            date: record.date,
            type: record.type, // 'water' | 'repot' | 'pest'
            note: record.note || null,
            createdAt: new Date().toISOString(),
        };
        records.push(newRecord);
        storage._set('pd_care_records', records);
        return newRecord;
    },

    deleteCareRecord(recordId) {
        let records = storage._get('pd_care_records');
        const rid = parseInt(recordId);
        records = records.filter(r => r.id !== rid);
        storage._set('pd_care_records', records);
    },

    deleteCareRecords(recordIds) {
        let records = storage._get('pd_care_records');
        const idsToDelete = new Set(recordIds.map(id => parseInt(id)));
        records = records.filter(r => !idsToDelete.has(r.id));
        storage._set('pd_care_records', records);
    },

    updateCareRecord(recordId, data) {
        let records = storage._get('pd_care_records');
        const rid = parseInt(recordId);
        const index = records.findIndex(r => r.id === rid);
        if (index === -1) return null;
        if (data.note !== undefined) records[index].note = data.note;
        if (data.type !== undefined) records[index].type = data.type;
        if (data.date !== undefined) records[index].date = data.date;
        storage._set('pd_care_records', records);
        return records[index];
    },

    getCareRecordsByMonth(plantId, year, month) {
        const records = this.getCareRecords(plantId);
        const prefix = `${year}-${String(month).padStart(2, '0')}`;
        return records.filter(r => r.date.startsWith(prefix));
    },

    getAllPlants() {
        return storage._get('pd_plants');
    },

    uploadImage(file) {
        return new Promise((resolve, reject) => {
            compressImage(file, 800, 0.7).then(compressedDataUrl => {
                resolve({ imageUrl: compressedDataUrl });
            }).catch(() => {
                // 압축 실패 시 원본 base64
                const reader = new FileReader();
                reader.onload = (e) => resolve({ imageUrl: e.target.result });
                reader.onerror = () => reject(new Error('파일 읽기 실패'));
                reader.readAsDataURL(file);
            });
        });
    },

    getStats() {
        const plants = this.getAllPlants();
        const locations = storage._get('pd_locations');
        const totalPlants = plants.length;
        const totalLocations = locations.length;
        const totalInvestment = plants.reduce((sum, p) => sum + (p.price || 0), 0);
        const prices = plants.filter(p => p.price).map(p => p.price);
        const avgPrice = prices.length ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : 0;
        const mostExpensive = plants.filter(p => p.price).sort((a, b) => b.price - a.price)[0];
        return {
            totalPlants, totalLocations, totalInvestment, averagePrice: avgPrice,
            mostExpensive: mostExpensive ? { name: mostExpensive.name, price: mostExpensive.price } : null,
            latestPlant: null,
        };
    },

    getStatsByLocation() {
        const locations = storage._get('pd_locations');
        const plants = storage._get('pd_plants');
        return locations.map(loc => {
            const locPlants = plants.filter(p => p.locationId === loc.id);
            return {
                locationId: loc.id,
                locationName: loc.name,
                plantCount: locPlants.length,
                totalInvestment: locPlants.reduce((sum, p) => sum + (p.price || 0), 0),
            };
        }).sort((a, b) => b.plantCount - a.plantCount);
    },

    getStatsByMonth() {
        const plants = storage._get('pd_plants');
        const monthly = {};
        plants.forEach(p => {
            if (p.purchaseDate) {
                const key = p.purchaseDate.substring(0, 7);
                if (!monthly[key]) monthly[key] = { count: 0, totalSpent: 0 };
                monthly[key].count++;
                monthly[key].totalSpent += p.price || 0;
            }
        });
        return Object.entries(monthly)
            .map(([month, data]) => ({ month, ...data }))
            .sort((a, b) => a.month.localeCompare(b.month));
    },

    searchPlants(query) {
        const plants = storage._get('pd_plants');
        const q = query.toLowerCase();
        return plants.filter(p =>
            (p.name || '').toLowerCase().includes(q) ||
            (p.purchasePlace || '').toLowerCase().includes(q) ||
            (p.memo || '').toLowerCase().includes(q)
        );
    },
};

// ============ 통합 API (서버/클라우드/로컬 자동 전환) ============

function getActiveApi() {
    if (storageMode === 'firebase') return firebaseApi;
    if (storageMode === 'cloud') return cloudApi;
    if (storageMode === 'local') return localApi;
    return null; // server mode → fetch 직접
}

const api = {
    async getLocations() {
        const active = getActiveApi();
        if (active) return active.getLocations();
        const res = await fetch(`${API_BASE}/locations`);
        if (!res.ok) throw new Error('장소 목록을 불러올 수 없습니다');
        return res.json();
    },

    async getLocation(id) {
        const active = getActiveApi();
        if (active) return active.getLocation(id);
        const res = await fetch(`${API_BASE}/locations/${id}`);
        if (!res.ok) throw new Error('장소를 찾을 수 없습니다');
        return res.json();
    },

    async createLocation(data) {
        const active = getActiveApi();
        if (active) return active.createLocation(data);
        const res = await fetch(`${API_BASE}/locations`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });
        if (!res.ok) throw new Error('장소 생성에 실패했습니다');
        return res.json();
    },

    async updateLocation(id, data) {
        const active = getActiveApi();
        if (active) return active.updateLocation(id, data);
        const res = await fetch(`${API_BASE}/locations/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });
        if (!res.ok) throw new Error('장소 수정에 실패했습니다');
        return res.json();
    },

    async deleteLocation(id) {
        const active = getActiveApi();
        if (active) return active.deleteLocation(id);
        const res = await fetch(`${API_BASE}/locations/${id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('장소 삭제에 실패했습니다');
    },

    async getPlantsByLocation(locationId) {
        const active = getActiveApi();
        if (active) return active.getPlantsByLocation(locationId);
        const res = await fetch(`${API_BASE}/plants/location/${locationId}`);
        if (!res.ok) throw new Error('식물 목록을 불러올 수 없습니다');
        return res.json();
    },

    async getPlant(id) {
        const active = getActiveApi();
        if (active) return active.getPlant(id);
        const res = await fetch(`${API_BASE}/plants/${id}`);
        if (!res.ok) throw new Error('식물을 찾을 수 없습니다');
        return res.json();
    },

    async createPlant(data, locationId) {
        const active = getActiveApi();
        if (active) return active.createPlant(data, locationId);
        const res = await fetch(`${API_BASE}/plants?locationId=${locationId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });
        if (!res.ok) throw new Error('식물 추가에 실패했습니다');
        return res.json();
    },

    async updatePlant(id, data) {
        const active = getActiveApi();
        if (active) return active.updatePlant(id, data);
        const res = await fetch(`${API_BASE}/plants/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });
        if (!res.ok) throw new Error('식물 수정에 실패했습니다');
        return res.json();
    },

    async deletePlant(id) {
        const active = getActiveApi();
        if (active) return active.deletePlant(id);
        const res = await fetch(`${API_BASE}/plants/${id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('식물 삭제에 실패했습니다');
    },

    async uploadImage(file) {
        const active = getActiveApi();
        if (active) return active.uploadImage(file);
        try {
            const compressedBlob = await compressImageToBlob(file, 1200, 0.8);
            const formData = new FormData();
            formData.append('file', compressedBlob, file.name || 'photo.jpg');
            const res = await fetch(`${API_BASE}/plants/upload`, { method: 'POST', body: formData });
            if (!res.ok) throw new Error('업로드 실패');
            return res.json();
        } catch (e) {
            return localApi.uploadImage(file);
        }
    },

    async getStats() {
        const active = getActiveApi();
        if (active) return active.getStats();
        const res = await fetch(`${PYTHON_API}/stats/summary`);
        if (!res.ok) throw new Error('통계를 불러올 수 없습니다');
        return res.json();
    },

    async getStatsByLocation() {
        const active = getActiveApi();
        if (active) return active.getStatsByLocation();
        const res = await fetch(`${PYTHON_API}/stats/by-location`);
        if (!res.ok) throw new Error('장소별 통계를 불러올 수 없습니다');
        return res.json();
    },

    async getStatsByMonth() {
        const active = getActiveApi();
        if (active) return active.getStatsByMonth();
        const res = await fetch(`${PYTHON_API}/stats/by-month`);
        if (!res.ok) throw new Error('월별 통계를 불러올 수 없습니다');
        return res.json();
    },

    async searchPlants(query) {
        const active = getActiveApi();
        if (active) return active.searchPlants(query);
        const res = await fetch(`${PYTHON_API}/search?q=${encodeURIComponent(query)}`);
        if (!res.ok) throw new Error('검색에 실패했습니다');
        return res.json();
    },

    getExportUrl() {
        return `${PYTHON_API}/export/csv`;
    },

    async getCareRecords(plantId) {
        const active = getActiveApi();
        if (active) return active.getCareRecords(plantId);
        const res = await fetch(`${API_BASE}/plants/${plantId}/care`);
        if (!res.ok) return [];
        return res.json();
    },

    async addCareRecord(plantId, record) {
        const active = getActiveApi();
        if (active) return active.addCareRecord(plantId, record);
        const res = await fetch(`${API_BASE}/plants/${plantId}/care`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(record),
        });
        if (!res.ok) throw new Error('기록 추가에 실패했습니다');
        return res.json();
    },

    async deleteCareRecord(recordId) {
        const active = getActiveApi();
        if (active) return active.deleteCareRecord(recordId);
        const res = await fetch(`${API_BASE}/care/${recordId}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('기록 삭제에 실패했습니다');
    },

    async deleteCareRecords(recordIds) {
        const active = getActiveApi();
        if (active) return active.deleteCareRecords(recordIds);
        await fetch(`${API_BASE}/care/batch-delete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: recordIds }),
        });
    },

    async updateCareRecord(recordId, data) {
        const active = getActiveApi();
        if (active) return active.updateCareRecord(recordId, data);
        const res = await fetch(`${API_BASE}/care/${recordId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });
        if (!res.ok) throw new Error('기록 수정에 실패했습니다');
        return res.json();
    },

    async getCareRecordsByMonth(plantId, year, month) {
        const active = getActiveApi();
        if (active) return active.getCareRecordsByMonth(plantId, year, month);
        const res = await fetch(`${API_BASE}/plants/${plantId}/care?year=${year}&month=${month}`);
        if (!res.ok) return [];
        return res.json();
    },

    getImageUrl(path) {
        if (!path) return '';
        if (path.startsWith('data:')) return path;
        if (path.startsWith('http')) return path;
        return path;
    },
};

// ============ 이미지 압축 유틸 ============

/**
 * 이미지를 Canvas로 리사이즈/압축하여 base64 DataURL로 반환
 */
function compressImage(file, maxSize, quality) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
            URL.revokeObjectURL(url);
            let { width, height } = img;
            if (width > maxSize || height > maxSize) {
                if (width > height) {
                    height = Math.round(height * maxSize / width);
                    width = maxSize;
                } else {
                    width = Math.round(width * maxSize / height);
                    height = maxSize;
                }
            }
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);
            const dataUrl = canvas.toDataURL('image/jpeg', quality);
            resolve(dataUrl);
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('이미지 로드 실패'));
        };
        img.src = url;
    });
}

/**
 * 이미지를 Canvas로 리사이즈/압축하여 Blob으로 반환 (서버 업로드용)
 */
function compressImageToBlob(file, maxSize, quality) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
            URL.revokeObjectURL(url);
            let { width, height } = img;
            if (width > maxSize || height > maxSize) {
                if (width > height) {
                    height = Math.round(height * maxSize / width);
                    width = maxSize;
                } else {
                    width = Math.round(width * maxSize / height);
                    height = maxSize;
                }
            }
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);
            canvas.toBlob(
                (blob) => {
                    if (blob) resolve(blob);
                    else reject(new Error('Blob 변환 실패'));
                },
                'image/jpeg',
                quality
            );
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('이미지 로드 실패'));
        };
        img.src = url;
    });
}
