window.APP_CONFIG = {
  student: {
    id: "amir",
    nameRu: "Амир",
    nameEn: "Amir",
    level: "A1",
    textbook: "English File",
    textbookEdition: "Pre-Intermediate A2"
  },
  interface: {
    language: "en",
    russianSupportPercent: 5,
    teacherTimeZone: "Europe/Riga"
  },
  site: {
    baseUrl: ""
  },
  supabase: {
    url: "https://zqzgarvmpqqqaobeicpc.supabase.co",
    anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpxemdhcnZtcHFxcWFvYmVpY3BjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE2ODQwNTIsImV4cCI6MjA5NzI2MDA1Mn0.gARetYwVZfInx3QKS0RvB2I5cOwegPMY5q3nJPX4ZP8",
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
