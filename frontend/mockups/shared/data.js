/* Mock data for the design mockups. Mirrors the backend shapes
   (PortalSchema / ActionLogEntrySchema from app/schemas.py) — nothing here is
   real; the actual frontend will take all data from the backend. */

window.MOCK_DATA = (function () {
  // ttlSeconds is a stand-in for (expires_at - now): positive = time left,
  // non-positive = the portal has expired and is derived "closed".
  const portals = [
    { id: 1, code: "А-01", name: "Альфа-Врата", world: "Мир Небесных Клинков", energy: 72, stability: 41, creatures: 3, marked: false, observer: true, closed: false, ttlSeconds: 7200, updatedMin: 12 },
    { id: 2, code: "Б-07", name: "Бездна", world: "Мир Вечной Ночи", energy: 95, stability: 12, creatures: 0, marked: false, observer: false, closed: false, ttlSeconds: 1080, updatedMin: 5 },
    { id: 3, code: "В-12", name: "Изумрудный Переход", world: "Лес Луны", energy: 45, stability: 78, creatures: 0, marked: true, observer: false, closed: false, ttlSeconds: 93600, updatedMin: 47 },
    { id: 4, code: "Г-03", name: "Шёпот", world: "Пустоши Пепла", energy: 58, stability: 88, creatures: 0, marked: false, observer: false, closed: false, ttlSeconds: -300, updatedMin: 9 },
    { id: 5, code: "Д-19", name: "Костяной Мост", world: "Хрустальные Границы", energy: 33, stability: 22, creatures: 5, marked: false, observer: true, closed: false, ttlSeconds: 2700, updatedMin: 21 },
    { id: 6, code: "Е-45", name: "Янтарная", world: "Архипелаг Дождей", energy: 51, stability: 64, creatures: 1, marked: false, observer: false, closed: false, ttlSeconds: 18000, updatedMin: 33 },
    { id: 7, code: "Ж-02", name: "Зеркальный", world: "Мир Тишины", energy: 88, stability: 30, creatures: 0, marked: true, observer: false, closed: false, ttlSeconds: 2100, updatedMin: 55 },
    { id: 8, code: "З-11", name: "Врата Снов", world: "Парящие Сады", energy: 20, stability: 95, creatures: 0, marked: false, observer: false, closed: false, ttlSeconds: 43200, updatedMin: 5 },
    { id: 9, code: "И-08", name: "Пепельный Вихрь", world: "Пылающие Низины", energy: 67, stability: 15, creatures: 2, marked: false, observer: true, closed: false, ttlSeconds: 3600, updatedMin: 8 },
    { id: 10, code: "К-23", name: "Стеклянная Гавань", world: "Острова Эха", energy: 39, stability: 73, creatures: 0, marked: false, observer: false, closed: false, ttlSeconds: 21600, updatedMin: 62 }
  ];

  const log = [
    { id: 152, portalId: 2, action: "STABILIZE", user: "admin", minutesAgo: 2 },
    { id: 151, portalId: 5, action: "SEND_OBSERVER", user: "admin", minutesAgo: 11 },
    { id: 150, portalId: 9, action: "WARN_CREATURES", user: "admin", minutesAgo: 18 },
    { id: 149, portalId: 3, action: "MARK", user: "operator", minutesAgo: 34 },
    { id: 148, portalId: 6, action: "DISMISS", user: "admin", minutesAgo: 52 },
    { id: 147, portalId: 1, action: "RECALL_OBSERVER", user: "operator", minutesAgo: 75 },
    { id: 146, portalId: 7, action: "UNMARK", user: "operator", minutesAgo: 110 },
    { id: 145, portalId: 10, action: "DISMISS", user: "admin", minutesAgo: 128 },
    { id: 144, portalId: 4, action: "CLOSE", user: "admin", minutesAgo: 170 },
    { id: 143, portalId: 8, action: "SEND_OBSERVER", user: "admin", minutesAgo: 200 },
    { id: 142, portalId: 2, action: "DISMISS", user: "admin", minutesAgo: 245 },
    { id: 141, portalId: 5, action: "MARK", user: "operator", minutesAgo: 300 }
  ];

  return { portals, log, user: { username: "admin", role: "Администратор" } };
})();
