import React, { useState } from 'react';
import ScheduleForecastSettings from './ScheduleForecastSettings';
import HolidayColorSettings from './HolidayColorSettings';

const ScheduleSettings = () => {
    const [activeTab, setActiveTab] = useState('forecast');

    return activeTab === 'forecast'
        ? <ScheduleForecastSettings activeTab={activeTab} onTabChange={setActiveTab} />
        : <HolidayColorSettings activeTab={activeTab} onTabChange={setActiveTab} />;
};

export default ScheduleSettings;
