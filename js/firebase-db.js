/**
 * Plant Diary - Firebase Realtime Database API
 * Firebase를 데이터 저장소로 사용합니다.
 * SDK 없이 REST API로 직접 통신하므로 별도 설치 불필요.
 */

// Firebase REST API 기반 DB 모듈
const firebaseDb = {
    baseUrl: null,

    init() {
        if (!FIREBASE_CONFIG || !FIREBASE_CONFIG.databaseURL || FIREBASE_CONFIG.databaseURL.includes('여기에')) {
            return false;
        }
        this.baseUrl = FIREBASE_CONFIG.databaseURL;
        return true;
    },

    // ============ 기본 CRUD ============

    async get(path) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        try {
            const res = await fetch(`${this.baseUrl}/${path}.json`, { signal: controller.signal });
            clearTimeout(timeout);
            if (!res.ok) throw new Error('Firebase 읽기 실패');
            return await res.json();
        } catch (e) {
            clearTimeout(timeout);
            throw e;
        }
    },

    async set(path, data) {
        const res = await fetch(`${this.baseUrl}/${path}.json`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });
        if (!res.ok) throw new Error('Firebase 쓰기 실패');
        return await res.json();
    },

    async push(path, data) {
        const res = await fetch(`${this.baseUrl}/${path}.json`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });
        if (!res.ok) throw new Error('Firebase 추가 실패');
        const result = await res.json();
        return result.name; // Firebase가 생성한 고유 key
    },

    async update(path, data) {
        const res = await fetch(`${this.baseUrl}/${path}.json`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });
        if (!res.ok) throw new Error('Firebase 수정 실패');
        return await res.json();
    },

    async remove(path) {
        const res = await fetch(`${this.baseUrl}/${path}.json`, {
            method: 'DELETE',
        });
        if (!res.ok) throw new Error('Firebase 삭제 실패');
    },

    // ============ 헬퍼: Object → Array 변환 ============

    toArray(obj) {
        if (!obj) return [];
        return Object.entries(obj).map(([key, value]) => ({ _key: key, ...value }));
    },
};

// ============ Firebase 기반 API 구현 ============

const firebaseApi = {
    // --- 장소 ---
    async getLocations() {
        const locations = firebaseDb.toArray(await firebaseDb.get('locations'));
        const plants = firebaseDb.toArray(await firebaseDb.get('plants'));
        return locations.map(loc => ({
            ...loc,
            id: loc._key,
            plantCount: plants.filter(p => p.locationId === loc._key).length,
        })).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    },

    async getLocation(id) {
        const loc = await firebaseDb.get(`locations/${id}`);
        return loc ? { ...loc, id } : null;
    },

    async createLocation(data) {
        const newLoc = { name: data.name, description: data.description || null, createdAt: new Date().toISOString() };
        const key = await firebaseDb.push('locations', newLoc);
        return { ...newLoc, id: key };
    },

    async updateLocation(id, data) {
        await firebaseDb.update(`locations/${id}`, { name: data.name, description: data.description || null });
        return { id, ...data };
    },

    async deleteLocation(id) {
        // 장소 삭제
        await firebaseDb.remove(`locations/${id}`);
        // 해당 장소의 식물 삭제
        const plants = firebaseDb.toArray(await firebaseDb.get('plants'));
        for (const plant of plants) {
            if (plant.locationId === id) {
                await firebaseDb.remove(`plants/${plant._key}`);
            }
        }
    },

    // --- 식물 ---
    async getPlantsByLocation(locationId) {
        const plants = firebaseDb.toArray(await firebaseDb.get('plants'));
        return plants.filter(p => p.locationId === locationId)
            .map(p => ({ ...p, id: p._key }))
            .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    },

    async getPlant(id) {
        const plant = await firebaseDb.get(`plants/${id}`);
        return plant ? { ...plant, id } : null;
    },

    async createPlant(data, locationId) {
        const newPlant = {
            locationId: locationId,
            name: data.name,
            imageUrl: data.imageUrl || null,
            price: data.price || null,
            purchaseDate: data.purchaseDate || null,
            purchasePlace: data.purchasePlace || null,
            memo: data.memo || null,
            createdAt: new Date().toISOString(),
        };
        const key = await firebaseDb.push('plants', newPlant);
        return { ...newPlant, id: key };
    },

    async updatePlant(id, data) {
        const updates = {};
        for (const key of ['name', 'imageUrl', 'price', 'purchaseDate', 'purchasePlace', 'memo', 'locationId']) {
            if (data[key] !== undefined) updates[key] = data[key];
        }
        await firebaseDb.update(`plants/${id}`, updates);
        return { id, ...updates };
    },

    async deletePlant(id) {
        await firebaseDb.remove(`plants/${id}`);
        // 관련 케어 기록 삭제
        const records = firebaseDb.toArray(await firebaseDb.get('careRecords'));
        for (const r of records) {
            if (r.plantId === id) await firebaseDb.remove(`careRecords/${r._key}`);
        }
    },

    async uploadImage(file) {
        // Firebase Storage 대신 base64로 DB에 직접 저장 (간단)
        const dataUrl = await compressImage(file, 600, 0.6);
        return { imageUrl: dataUrl };
    },

    // --- 케어 기록 ---
    async getCareRecords(plantId) {
        const records = firebaseDb.toArray(await firebaseDb.get('careRecords'));
        return records.filter(r => r.plantId === plantId).map(r => ({ ...r, id: r._key }));
    },

    async getCareRecordsByMonth(plantId, year, month) {
        const records = await this.getCareRecords(plantId);
        const prefix = `${year}-${String(month).padStart(2, '0')}`;
        return records.filter(r => (r.date || '').startsWith(prefix));
    },

    async addCareRecord(plantId, record) {
        const newRecord = {
            plantId: plantId,
            date: record.date,
            type: record.type,
            note: record.note || null,
            createdAt: new Date().toISOString(),
        };
        const key = await firebaseDb.push('careRecords', newRecord);
        return { ...newRecord, id: key };
    },

    async deleteCareRecord(recordId) {
        await firebaseDb.remove(`careRecords/${recordId}`);
    },

    async deleteCareRecords(recordIds) {
        for (const id of recordIds) {
            await firebaseDb.remove(`careRecords/${id}`);
        }
    },

    async updateCareRecord(recordId, data) {
        const updates = {};
        if (data.note !== undefined) updates.note = data.note;
        if (data.type !== undefined) updates.type = data.type;
        if (data.date !== undefined) updates.date = data.date;
        await firebaseDb.update(`careRecords/${recordId}`, updates);
        return { id: recordId, ...updates };
    },

    // --- 통계 ---
    async getStats() {
        const plants = firebaseDb.toArray(await firebaseDb.get('plants'));
        const locations = firebaseDb.toArray(await firebaseDb.get('locations'));
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
        const locations = firebaseDb.toArray(await firebaseDb.get('locations'));
        const plants = firebaseDb.toArray(await firebaseDb.get('plants'));
        return locations.map(loc => {
            const locPlants = plants.filter(p => p.locationId === loc._key);
            return {
                locationId: loc._key, locationName: loc.name,
                plantCount: locPlants.length,
                totalInvestment: locPlants.reduce((s, p) => s + (p.price || 0), 0),
            };
        }).sort((a, b) => b.plantCount - a.plantCount);
    },

    async getStatsByMonth() {
        const plants = firebaseDb.toArray(await firebaseDb.get('plants'));
        const monthly = {};
        plants.forEach(p => {
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
        const plants = firebaseDb.toArray(await firebaseDb.get('plants'));
        const q = query.toLowerCase();
        return plants.filter(p =>
            (p.name || '').toLowerCase().includes(q) ||
            (p.purchasePlace || '').toLowerCase().includes(q) ||
            (p.memo || '').toLowerCase().includes(q)
        ).map(p => ({ ...p, id: p._key }));
    },
};
