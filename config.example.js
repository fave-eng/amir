window.APP_CONFIG = {
  student: {
    id: "student-id",
    nameRu: "",
    nameEn: "Student",
    level: "A1",
    textbook: "English File",
    textbookEdition: ""
  },
  interface: {
    language: "en",
    russianSupportPercent: 5,
    teacherTimeZone: "Europe/Riga"
  },
  site: { baseUrl: "" },
  supabase: {
    url: "",
    anonKey: "",
    tables: {
      homework: "homework_progress",
      vocabulary: "vocabulary_progress",
      vocabularyTopics: "vocabulary_topic_progress",
      grammar: "grammar_progress"
    }
  },
  features: {
    homework: true,
    vocabulary: true,
    wordPronunciation: true,
    grammar: true,
    cloudSync: true,
    telegramNotifications: true
  }
};
