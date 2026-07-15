package com.junegod.dasuozi;

import static org.junit.Assert.assertEquals;

import android.content.Context;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;

/**
 * 打索子 Android 设备测试示例。
 *
 * <p>该测试需要在模拟器或真实设备上执行，用于验证应用上下文的包名配置。</p>
 */
@RunWith(AndroidJUnit4.class)
public class ExampleInstrumentedTest {

    /**
     * 验证设备运行时读取到的应用包名。
     */
    @Test
    public void useAppContext() {
        Context appContext = InstrumentationRegistry.getInstrumentation().getTargetContext();

        assertEquals("com.junegod.dasuozi", appContext.getPackageName());
    }
}
