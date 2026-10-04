plugins {
    id("com.android.application")
}

android {
    namespace = "com.draw01.phonebridge"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.draw01.phonebridge"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
