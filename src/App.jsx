import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Search, TrendingUp, TrendingDown, Activity, Flame, Zap, X } from 'lucide-react';

const BybitLeverageCalculator = () => {
  // Utility function for consistent money formatting
  const formatCurrency = (amount, options = {}) => {
    const {
      decimals = 2,
      showCents = true,
      prefix = '$',
      suffix = ''
    } = options;
    
    if (amount === null || amount === undefined) return 'N/A';
    
    const num = parseFloat(amount);
    if (isNaN(num)) return 'N/A';
    
    // For crypto prices, show more decimals if needed
    const finalDecimals = showCents ? Math.max(decimals, num < 1 ? 4 : 2) : decimals;
    
    return `${prefix}${num.toLocaleString('en-US', {
      minimumFractionDigits: finalDecimals,
      maximumFractionDigits: finalDecimals
    })}${suffix}`;
  };

  // Format price with proper crypto precision
  const formatPrice = (price) => {
    if (!price) return 'N/A';
    const num = parseFloat(price);
    if (num >= 1000) return formatCurrency(num, { decimals: 2 });
    if (num >= 1) return formatCurrency(num, { decimals: 4 });
    return formatCurrency(num, { decimals: 6 });
  };
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [selectedPair, setSelectedPair] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [currentPrice, setCurrentPrice] = useState(null);
  const [previousPrice, setPreviousPrice] = useState(null);
  const [priceChange, setPriceChange] = useState(null); // 'up', 'down', or null
  const [lastUpdate, setLastUpdate] = useState(null);
  const [isLivePriceActive, setIsLivePriceActive] = useState(false);
  const [leverageInfo, setLeverageInfo] = useState(null);
  const [trendingPairs, setTrendingPairs] = useState([]);
  const [loadingTrending, setLoadingTrending] = useState(false);
  const [trendingProgress, setTrendingProgress] = useState(100);
  const priceIntervalRef = useRef(null);
  const trendingIntervalRef = useRef(null);
  const trendingProgressIntervalRef = useRef(null);
  
  // Trading inputs
  const [positionType, setPositionType] = useState('Long');
  const [leverage, setLeverage] = useState(1);
  const [entryAmount, setEntryAmount] = useState('');
  const [targets, setTargets] = useState({ target1: '', target2: '', target3: '' });

  // Throttled search function with useCallback
  const throttledSearch = useCallback(() => {
    let timeoutId;
    return (searchValue) => {
      clearTimeout(timeoutId);
      setLoading(true);
      timeoutId = setTimeout(() => {
        if (searchValue.length >= 2) {
          searchCryptoPairs(searchValue);
        } else {
          setSearchResults([]);
          setLoading(false);
        }
      }, 500);
    };
  }, [])();

  // Real-time price fetching function
  const fetchCurrentPrice = useCallback(async (pair) => {
    if (!pair) return;
    
    try {
      const response = await fetch(`https://api.bybit.com/v5/market/tickers?category=linear&symbol=${pair.baseSymbol}`);
      const data = await response.json();
      
      if (data.retCode === 0 && data.result.list.length > 0) {
        const newPrice = parseFloat(data.result.list[0].lastPrice);
        
        // Update price change indicator
        if (currentPrice !== null) {
          setPreviousPrice(currentPrice);
          if (newPrice > currentPrice) {
            setPriceChange('up');
          } else if (newPrice < currentPrice) {
            setPriceChange('down');
          }
          
          // Clear price change indicator after 2 seconds
          setTimeout(() => setPriceChange(null), 2000);
        }
        
        setCurrentPrice(newPrice);
        setLastUpdate(new Date());
        setError('');
      }
    } catch (error) {
      console.error('Error fetching real-time price:', error);
      // Don't show error for real-time updates to avoid spam
    }
  }, [currentPrice]);

  // Start/stop price monitoring
  useEffect(() => {
    if (selectedPair && isLivePriceActive) {
      // Fetch immediately
      fetchCurrentPrice(selectedPair);
      
      // Set up interval for every 3 seconds
      priceIntervalRef.current = setInterval(() => {
        fetchCurrentPrice(selectedPair);
      }, 3000);
    } else {
      // Clear interval
      if (priceIntervalRef.current) {
        clearInterval(priceIntervalRef.current);
        priceIntervalRef.current = null;
      }
    }

    return () => {
      if (priceIntervalRef.current) {
        clearInterval(priceIntervalRef.current);
        priceIntervalRef.current = null;
      }
    };
  }, [selectedPair, isLivePriceActive, fetchCurrentPrice]);

  // Fetch trending pairs based on volume and price change
  const fetchTrendingPairs = useCallback(async () => {
    try {
      setLoadingTrending(true);
      setTrendingProgress(100); // Reset progress bar when fetching starts
      
      // Get both tickers and instruments data in parallel
      const [tickersResponse, instrumentsResponse] = await Promise.all([
        fetch('https://api.bybit.com/v5/market/tickers?category=linear'),
        fetch('https://api.bybit.com/v5/market/instruments-info?category=linear')
      ]);
      
      const tickersData = await tickersResponse.json();
      const instrumentsData = await instrumentsResponse.json();
      
      if (tickersData.retCode === 0 && instrumentsData.retCode === 0) {
        // Create instruments lookup for leverage info
        const instrumentsMap = new Map();
        instrumentsData.result?.list?.forEach(item => {
          instrumentsMap.set(item.symbol, {
            minLeverage: parseFloat(item.leverageFilter?.minLeverage || '1'),
            maxLeverage: parseFloat(item.leverageFilter?.maxLeverage || '100')
          });
        });
        
        const validPairs = tickersData.result?.list
          ?.filter(ticker => 
            ticker.symbol.endsWith('USDT') &&
            parseFloat(ticker.volume24h) > 1000000 && // Min volume filter
            parseFloat(ticker.lastPrice) > 0 &&
            instrumentsMap.has(ticker.symbol) // Must have leverage info
          )
          .map(ticker => {
            const leverageInfo = instrumentsMap.get(ticker.symbol);
            return {
              symbol: ticker.symbol,
              baseSymbol: ticker.symbol,
              lastPrice: parseFloat(ticker.lastPrice),
              priceChangePercent: parseFloat(ticker.price24hPcnt || 0) * 100,
              volume24h: parseFloat(ticker.volume24h),
              isHot: Math.abs(parseFloat(ticker.price24hPcnt || 0)) > 0.05, // >5% change
              category: 'linear',
              categoryLabel: 'USDT Perpetual',
              minLeverage: leverageInfo.minLeverage,
              maxLeverage: leverageInfo.maxLeverage
            };
          })
          .sort((a, b) => b.volume24h - a.volume24h) // Sort by volume
          .slice(0, 8); // Top 8 trending pairs
        
        setTrendingPairs(validPairs || []);
      }
    } catch (error) {
      console.error('Error fetching trending pairs:', error);
    } finally {
      setLoadingTrending(false);
    }
  }, []);

  // Auto-update trending pairs with progress bar
  useEffect(() => {
    // Fetch trending pairs on mount
    fetchTrendingPairs();
    
    // Update every 10 seconds
    trendingIntervalRef.current = setInterval(() => {
      fetchTrendingPairs();
      setTrendingProgress(100); // Reset progress bar
    }, 10000);
    
    // Progress bar animation (updates every 100ms)
    trendingProgressIntervalRef.current = setInterval(() => {
      setTrendingProgress(prev => {
        const newProgress = prev - 1; // Decrease by 1% every 100ms (10 seconds = 1000ms/10ms = 100 steps)
        return newProgress <= 0 ? 100 : newProgress; // Reset when reaches 0
      });
    }, 100);
    
    return () => {
      if (trendingIntervalRef.current) {
        clearInterval(trendingIntervalRef.current);
        trendingIntervalRef.current = null;
      }
      if (trendingProgressIntervalRef.current) {
        clearInterval(trendingProgressIntervalRef.current);
        trendingProgressIntervalRef.current = null;
      }
    };
  }, [fetchTrendingPairs]);

  // URL state management helpers
  const updateURL = useCallback(() => {
    const params = new URLSearchParams();
    
    if (selectedPair) {
      params.set('pair', selectedPair.baseSymbol);
      params.set('position', positionType);
      params.set('leverage', leverage.toString());
      
      if (entryAmount) params.set('entry', entryAmount);
      if (targets.target1) params.set('t1', targets.target1);
      if (targets.target2) params.set('t2', targets.target2);
      if (targets.target3) params.set('t3', targets.target3);
    }
    
    const newURL = `${window.location.pathname}${params.toString() ? '?' + params.toString() : ''}`;
    window.history.replaceState({}, '', newURL);
  }, [selectedPair, positionType, leverage, entryAmount, targets]);

  // Load state from URL on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const pairFromURL = params.get('pair');
    
    if (pairFromURL) {
      // Find and select the pair from URL (search both linear and inverse)
      const searchPair = async () => {
        try {
          // Search both categories like in the regular search
          const categories = ['linear', 'inverse'];
          const searchPromises = categories.map(category => 
            fetch(`https://api.bybit.com/v5/market/instruments-info?category=${category}`)
              .then(res => res.json())
              .then(data => ({ category, data }))
              .catch(err => ({ category, error: err }))
          );

          const results = await Promise.all(searchPromises);
          let foundPair = null;
          let foundCategory = null;

          // Search through both categories
          for (const { category, data, error } of results) {
            if (!error && data?.retCode === 0 && data?.result?.list) {
              const pair = data.result.list.find(item => 
                item.symbol === pairFromURL && 
                item.status === 'Trading' && 
                item.leverageFilter &&
                parseFloat(item.leverageFilter.maxLeverage) > 1
              );
              
              if (pair) {
                foundPair = pair;
                foundCategory = category;
                break;
              }
            }
          }
          
          if (foundPair && foundCategory) {
            const pairObj = {
              symbol: foundCategory === 'linear' ? foundPair.symbol : foundPair.symbol + '.I',
              baseSymbol: foundPair.symbol,
              category: foundCategory,
              categoryLabel: foundCategory === 'linear' ? 'USDT Perpetual' : 'Inverse Perpetual',
              minLeverage: parseFloat(foundPair.leverageFilter?.minLeverage || '1'),
              maxLeverage: parseFloat(foundPair.leverageFilter?.maxLeverage || '100')
            };
            
            // Restore all state from URL
            setSelectedPair(pairObj);
            setLeverageInfo({ min: pairObj.minLeverage, max: pairObj.maxLeverage });
            
            const urlPosition = params.get('position');
            if (urlPosition) setPositionType(urlPosition);
            
            const urlLeverage = params.get('leverage');
            if (urlLeverage) setLeverage(parseFloat(urlLeverage));
            
            const urlEntry = params.get('entry');
            if (urlEntry) setEntryAmount(urlEntry);
            
            const urlTargets = {
              target1: params.get('t1') || '',
              target2: params.get('t2') || '',
              target3: params.get('t3') || ''
            };
            setTargets(urlTargets);
            
            // Fetch current price and start monitoring
            setIsLivePriceActive(true);
          } else {
            console.warn(`Pair ${pairFromURL} not found in any category`);
          }
        } catch (error) {
          console.error('Error loading pair from URL:', error);
        }
      };
      
      searchPair();
    }
  }, []);

  // Update URL when state changes
  useEffect(() => {
    if (selectedPair) {
      updateURL();
    }
  }, [selectedPair, positionType, leverage, entryAmount, targets, updateURL]);

  // Reset app to initial state (back to trending pairs)
  const resetToInitialState = () => {
    // Clear pair selection
    setSelectedPair(null);
    setCurrentPrice(null);
    setPreviousPrice(null);
    setPriceChange(null);
    setLastUpdate(null);
    setIsLivePriceActive(false);
    setLeverageInfo(null);
    
    // Clear trading inputs
    setPositionType('Long');
    setLeverage(1);
    setEntryAmount('');
    setTargets({ target1: '', target2: '', target3: '' });
    
    // Clear search
    setSearchTerm('');
    setSearchResults([]);
    setLoading(false);
    setError('');
    
    // Clear any price monitoring intervals
    if (priceIntervalRef.current) {
      clearInterval(priceIntervalRef.current);
      priceIntervalRef.current = null;
    }
    
    // Clear URL parameters
    window.history.replaceState({}, '', window.location.pathname);
  };

  const searchCryptoPairs = async (searchValue) => {
    console.log('Searching for:', searchValue);
    setError('');
    try {
      // Search only perpetual markets (linear and inverse) - no spot trading
      const categories = ['linear', 'inverse'];
      const searchPromises = categories.map(category => 
        fetch(`https://api.bybit.com/v5/market/instruments-info?category=${category}`)
          .then(res => res.json())
          .then(data => ({ category, data }))
          .catch(err => ({ category, error: err }))
      );

      const results = await Promise.all(searchPromises);
      let allPairs = [];

      results.forEach(({ category, data, error }) => {
        if (!error && data?.retCode === 0 && data?.result?.list) {
          const pairs = data.result.list
            .filter(item => {
              const symbol = item.symbol || '';
              const searchLower = searchValue.toLowerCase();
              const matchesSearch = symbol.toLowerCase().includes(searchLower) &&
                                  (symbol.endsWith('USDT') || symbol.endsWith('USD'));
              
              // Only perpetual contracts with leverage
              return matchesSearch && 
                     item.status === 'Trading' && 
                     item.leverageFilter &&
                     parseFloat(item.leverageFilter.maxLeverage) > 1;
            })
            .map(item => ({
              symbol: category === 'linear' ? item.symbol : item.symbol + '.I',
              baseSymbol: item.symbol,
              category: category,
              minLeverage: parseFloat(item.leverageFilter?.minLeverage || '1'),
              maxLeverage: parseFloat(item.leverageFilter?.maxLeverage || '100'),
              categoryLabel: category === 'linear' ? 'USDT Perpetual' : 'Inverse Perpetual'
            }));
          
          allPairs = allPairs.concat(pairs);
        }
      });

      // Remove duplicates and prioritize linear (USDT perpetual) contracts
      const uniquePairs = [];
      const seenSymbols = new Set();
      
      // First add linear contracts (USDT perpetuals - most popular)
      allPairs.filter(pair => pair.category === 'linear').forEach(pair => {
        if (!seenSymbols.has(pair.baseSymbol)) {
          uniquePairs.push(pair);
          seenSymbols.add(pair.baseSymbol);
        }
      });
      
      // Then add inverse contracts if not already present
      allPairs.filter(pair => pair.category === 'inverse').forEach(pair => {
        if (!seenSymbols.has(pair.baseSymbol)) {
          uniquePairs.push(pair);
          seenSymbols.add(pair.baseSymbol);
        }
      });
      
      const finalResults = uniquePairs.slice(0, 12); // Focused results
      
      setSearchResults(finalResults);
      if (finalResults.length === 0) {
        setError(`No trading pairs found for "${searchValue}". Try searching for popular coins like BTC, ETH, or SOL.`);
      }
    } catch (error) {
      console.error('Error fetching pairs:', error);
      setError('Unable to connect to Bybit API. Please check your internet connection and try again.');
      setSearchResults([]);
    }
    setLoading(false);
  };

  const selectPair = async (pair) => {
    setSelectedPair(pair);
    setSearchResults([]);
    setSearchTerm('');
    setLeverageInfo({ min: pair.minLeverage, max: pair.maxLeverage });
    setLeverage(pair.minLeverage);
    setError('');
    
    // Reset price states
    setCurrentPrice(null);
    setPreviousPrice(null);
    setPriceChange(null);
    setLastUpdate(null);
    
    // Fetch initial price and start live monitoring
    try {
      const response = await fetch(`https://api.bybit.com/v5/market/tickers?category=linear&symbol=${pair.baseSymbol}`);
      const data = await response.json();
      
      if (data.retCode === 0 && data.result.list.length > 0) {
        setCurrentPrice(parseFloat(data.result.list[0].lastPrice));
        setLastUpdate(new Date());
        setIsLivePriceActive(true); // Enable live price monitoring
      } else {
        setError('Failed to fetch current price for this pair.');
        setCurrentPrice(null);
        setIsLivePriceActive(false);
      }
    } catch (error) {
      console.error('Error fetching price:', error);
      setError('Unable to fetch current price. Please try again.');
      setCurrentPrice(null);
      setIsLivePriceActive(false);
    }
  };

  const handleSearchChange = (e) => {
    const value = e.target.value;
    setSearchTerm(value);
    setError(''); // Clear previous errors
    console.log('Search input changed:', value);
    
    if (value.length >= 2) {
      throttledSearch(value);
    } else {
      setSearchResults([]);
      setLoading(false);
    }
  };

  const handleTargetChange = (targetKey, value) => {
    setTargets(prev => ({ ...prev, [targetKey]: value }));
  };

  const calculateResults = () => {
    if (!selectedPair || !currentPrice || !entryAmount || !targets.target1) return [];
    
    const entryAmountNum = parseFloat(entryAmount);
    const positionSize = entryAmountNum * leverage;
    const quantity = positionSize / currentPrice;
    
    const results = [];
    const bybitFeeRate = 0.0006; // 0.06% taker fee
    
    ['target1', 'target2', 'target3'].forEach((targetKey, index) => {
      const targetPrice = parseFloat(targets[targetKey]);
      if (!targetPrice) return;
      
      const isLong = positionType === 'Long';
      let pnl;
      
      if (isLong) {
        pnl = (targetPrice - currentPrice) * quantity;
      } else {
        pnl = (currentPrice - targetPrice) * quantity;
      }
      
      // Calculate fees (entry + exit)
      const entryFee = positionSize * bybitFeeRate;
      const exitFee = (quantity * targetPrice) * bybitFeeRate;
      const totalFees = entryFee + exitFee;
      
      const netPnl = pnl - totalFees;
      const roi = (netPnl / entryAmountNum) * 100;
      
      results.push({
        target: index + 1,
        targetPrice,
        pnl: netPnl,
        roi,
        fees: totalFees,
        finalAmount: entryAmountNum + netPnl
      });
    });
    
    return results;
  };

  const results = calculateResults();

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 via-slate-900 to-gray-900 text-gray-100">
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold mb-2 bg-gradient-to-r from-cyan-400 via-blue-500 to-purple-500 bg-clip-text text-transparent">
            Bybit Leverage Calculator
          </h1>
          <p className="text-gray-400">Calculate profits with precision for perpetual futures</p>
        </div>

        {/* Search Section */}
        <div className="bg-gray-900/70 backdrop-blur-sm rounded-xl p-6 mb-6 border border-gray-700/50 shadow-lg">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500 w-5 h-5" />
            <input
              type="text"
              value={searchTerm}
              onChange={handleSearchChange}
              placeholder="Search crypto (e.g., btc, eth, sol...)"
              className="w-full pl-10 pr-4 py-3 bg-gray-800/60 border border-gray-600/50 rounded-lg text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 transition-all"
            />
          </div>
          
          {loading && (
            <div className="mt-4 text-center text-gray-500">
              <div className="inline-flex items-center">
                <div className="animate-spin rounded-full h-4 w-4 border-2 border-cyan-500 border-t-transparent mr-2"></div>
                Searching...
              </div>
            </div>
          )}
          
          {error && (
            <div className="mt-4 p-3 bg-red-900/20 border border-red-500/40 rounded-lg text-red-300 text-sm">
              ⚠️ {error}
            </div>
          )}
          
          {searchResults.length > 0 && (
            <div className="mt-4 max-h-60 overflow-y-auto">
              {searchResults.map((pair) => (
                <button
                  key={pair.symbol}
                  onClick={() => selectPair(pair)}
                  className="w-full text-left p-3 hover:bg-gray-800/60 rounded-lg border-b border-gray-700/50 last:border-b-0 transition-all duration-200 hover:border-cyan-500/30"
                >
                  <div className="flex justify-between items-center">
                    <div className="flex flex-col">
                      <span className="font-medium text-cyan-300">{pair.symbol}</span>
                      <span className="text-xs text-gray-500">{pair.categoryLabel}</span>
                    </div>
                    <span className="text-sm text-gray-400 bg-gray-800/50 px-2 py-1 rounded">
                      {pair.minLeverage}x - {pair.maxLeverage}x
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Trending Pairs - Show when not searching */}
        {!searchTerm && searchResults.length === 0 && !selectedPair && (
          <div className="bg-gray-900/70 backdrop-blur-sm rounded-xl border border-gray-700/50 shadow-lg overflow-hidden mb-6">
            {/* Progress bar at the top */}
            <div className="h-1 bg-gray-800">
              <div 
                className="h-full bg-gradient-to-r from-orange-500 via-orange-400 to-yellow-500 transition-all duration-100 ease-linear"
                style={{ width: `${trendingProgress}%` }}
              ></div>
            </div>
            
            <div className="p-6">
              <div className="flex items-center gap-2 mb-4">
                <Flame className="w-5 h-5 text-orange-500" />
                <h3 className="text-lg font-semibold text-gray-100">Trending Perpetuals</h3>
                <span className="text-xs text-gray-500">
                  Live updates
                </span>
              </div>
            
            {loadingTrending ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[...Array(8)].map((_, i) => (
                  <div key={i} className="bg-gray-800/40 rounded-lg p-3 animate-pulse">
                    <div className="h-4 bg-gray-700 rounded w-20 mb-2"></div>
                    <div className="h-3 bg-gray-700 rounded w-16 mb-1"></div>
                    <div className="h-3 bg-gray-700 rounded w-12"></div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {trendingPairs.map((pair) => (
                  <button
                    key={pair.symbol}
                    onClick={() => selectPair(pair)}
                    className="bg-gray-800/40 hover:bg-gray-800/70 rounded-lg p-3 transition-all duration-200 hover:border-cyan-500/30 border border-transparent group"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-medium text-cyan-300 text-sm group-hover:text-cyan-200">
                        {pair.symbol.replace('USDT', '')}
                      </span>
                      {pair.isHot && (
                        <Zap className="w-3 h-3 text-yellow-500" />
                      )}
                    </div>
                    
                    <div className="text-left">
                      <div className="text-white font-mono text-sm mb-1">
                        {formatPrice(pair.lastPrice)}
                      </div>
                      <div className={`text-xs font-medium ${
                        pair.priceChangePercent >= 0 
                          ? 'text-green-400' 
                          : 'text-red-400'
                      }`}>
                        {pair.priceChangePercent >= 0 ? '+' : ''}
                        {pair.priceChangePercent.toFixed(2)}%
                      </div>
                    </div>
                    
                    <div className="text-xs text-gray-500 mt-1">
                      Vol: {formatCurrency(pair.volume24h / 1000000, { decimals: 1, prefix: '$', suffix: 'M' })}
                    </div>
                  </button>
                ))}
              </div>
            )}
            
              <div className="mt-4 text-center">
                <p className="text-xs text-gray-500">
                  Click any pair to start calculating leverage profits
                </p>
              </div>
            </div>
          </div>
        )}

        {selectedPair && (
          <>
            {/* Selected Pair Info */}
            <div className="bg-gray-900/70 backdrop-blur-sm rounded-xl p-6 mb-6 border border-gray-700/50 shadow-lg relative">
              {/* Close button */}
              <button
                onClick={resetToInitialState}
                className="absolute -top-2 -right-2 w-8 h-8 bg-gray-800 hover:bg-gray-700 rounded-full transition-all duration-200 group border-2 border-gray-600 flex items-center justify-center"
                title="Close and return to trending pairs"
              >
                <X className="w-4 h-4 text-gray-300 group-hover:text-white" />
              </button>
              
              <div className="flex items-center justify-between mb-4 pr-12">
                <h2 className="text-2xl font-bold text-cyan-300">{selectedPair.symbol}</h2>
                <div className="text-right">
                  {currentPrice ? (
                    <div className="flex flex-col items-end">
                      <div className="flex items-center gap-2">
                        <span className={`text-2xl font-bold transition-colors duration-500 ${
                          priceChange === 'up' ? 'text-green-400' : 
                          priceChange === 'down' ? 'text-red-400' : 'text-blue-400'
                        }`}>
                          {formatPrice(currentPrice)}
                        </span>
                        {isLivePriceActive && (
                          <div className="flex items-center gap-1">
                            <Activity className={`w-4 h-4 ${
                              priceChange === 'up' ? 'text-green-400' : 
                              priceChange === 'down' ? 'text-red-400' : 'text-blue-400'
                            } animate-pulse`} />
                            {priceChange === 'up' && <TrendingUp className="w-4 h-4 text-green-400" />}
                            {priceChange === 'down' && <TrendingDown className="w-4 h-4 text-red-400" />}
                          </div>
                        )}
                      </div>
                      {lastUpdate && (
                        <span className="text-xs text-gray-500 mt-1">
                          Last updated: {lastUpdate.toLocaleTimeString()}
                        </span>
                      )}
                    </div>
                  ) : (
                    <span className="text-red-400 text-sm">Price unavailable</span>
                  )}
                </div>
              </div>
              {error && (
                <div className="mt-2 p-3 bg-red-900/20 border border-red-500/40 rounded-lg text-red-300 text-sm">
                  ⚠️ {error}
                </div>
              )}
            </div>

            {/* Trading Inputs */}
            <div className="bg-gray-900/70 backdrop-blur-sm rounded-xl p-6 mb-6 border border-gray-700/50 shadow-lg">
              <h3 className="text-xl font-semibold mb-4 text-gray-100">Trading Setup</h3>
              
              {/* Position Type */}
              <div className="mb-6">
                <label className="block text-sm font-medium mb-2 text-gray-300">Position Type</label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setPositionType('Long')}
                    className={`flex-1 py-3 px-4 rounded-lg font-medium transition-all duration-200 ${
                      positionType === 'Long'
                        ? 'bg-gradient-to-r from-green-600 to-green-700 text-white shadow-lg shadow-green-600/20'
                        : 'bg-gray-800/60 text-gray-300 hover:bg-gray-700/60 border border-gray-600/50'
                    }`}
                  >
                    <TrendingUp className="inline w-4 h-4 mr-2" />
                    Long
                  </button>
                  <button
                    onClick={() => setPositionType('Short')}
                    className={`flex-1 py-3 px-4 rounded-lg font-medium transition-all duration-200 ${
                      positionType === 'Short'
                        ? 'bg-gradient-to-r from-red-600 to-red-700 text-white shadow-lg shadow-red-600/20'
                        : 'bg-gray-800/60 text-gray-300 hover:bg-gray-700/60 border border-gray-600/50'
                    }`}
                  >
                    <TrendingDown className="inline w-4 h-4 mr-2" />
                    Short
                  </button>
                </div>
              </div>

              {/* Leverage Slider */}
              {leverageInfo && (
                <div className="mb-6">
                  <label className="block text-sm font-medium mb-2 text-gray-300">
                    Leverage: <span className="text-cyan-400 font-bold">{leverage}x</span>
                  </label>
                  <div className="px-2">
                    <input
                      type="range"
                      min={leverageInfo.min}
                      max={leverageInfo.max}
                      step="0.1"
                      value={leverage}
                      onChange={(e) => setLeverage(parseFloat(e.target.value))}
                      className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer slider"
                    />
                    <div className="flex justify-between text-sm text-gray-500 mt-1">
                      <span>{leverageInfo.min}x</span>
                      <span>{leverageInfo.max}x</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Entry Amount */}
              <div className="mb-6">
                <label className="block text-sm font-medium mb-2 text-gray-300">Entry Amount (USDT)</label>
                <input
                  type="number"
                  value={entryAmount}
                  onChange={(e) => setEntryAmount(e.target.value)}
                  placeholder="Enter amount in USDT"
                  className="w-full py-3 px-4 bg-gray-800/60 border border-gray-600/50 rounded-lg text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 transition-all"
                />
              </div>

              {/* Target Prices */}
              <div className="space-y-4">
                <h4 className="text-lg font-medium text-gray-100">Target Prices</h4>
                <div className="grid gap-4 md:grid-cols-3">
                  <div>
                    <label className="block text-sm font-medium mb-2 text-green-400">
                      Target #1 (Required)
                    </label>
                    <input
                      type="number"
                      value={targets.target1}
                      onChange={(e) => handleTargetChange('target1', e.target.value)}
                      placeholder="Price"
                      className="w-full py-2 px-3 bg-gray-800/60 border border-gray-600/50 rounded-lg text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2 text-blue-400">
                      Target #2 (Optional)
                    </label>
                    <input
                      type="number"
                      value={targets.target2}
                      onChange={(e) => handleTargetChange('target2', e.target.value)}
                      placeholder="Price"
                      className="w-full py-2 px-3 bg-gray-800/60 border border-gray-600/50 rounded-lg text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2 text-purple-400">
                      Target #3 (Optional)
                    </label>
                    <input
                      type="number"
                      value={targets.target3}
                      onChange={(e) => handleTargetChange('target3', e.target.value)}
                      placeholder="Price"
                      className="w-full py-2 px-3 bg-gray-800/60 border border-gray-600/50 rounded-lg text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500 transition-all"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Results */}
            {results.length > 0 && (
              <div className="bg-gray-900/70 backdrop-blur-sm rounded-xl p-6 border border-gray-700/50 shadow-lg">
                <h3 className="text-xl font-semibold mb-4 text-gray-100">Profit Analysis</h3>
                <div className="space-y-4">
                  {results.map((result) => (
                    <div
                      key={result.target}
                      className={`p-4 rounded-lg border backdrop-blur-sm transition-all duration-200 ${
                        result.pnl >= 0
                          ? 'bg-green-900/20 border-green-500/40 shadow-green-500/10 shadow-lg'
                          : 'bg-red-900/20 border-red-500/40 shadow-red-500/10 shadow-lg'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-3">
                        <span className="font-semibold text-gray-100">Target #{result.target}</span>
                        <span className="text-cyan-300 font-mono">{formatPrice(result.targetPrice)}</span>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                        <div className="text-center p-2 bg-gray-800/30 rounded-lg">
                          <span className="text-gray-400 block mb-1">P&L</span>
                          <span className={`font-bold text-lg ${result.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {formatCurrency(result.pnl)}
                          </span>
                        </div>
                        <div className="text-center p-2 bg-gray-800/30 rounded-lg">
                          <span className="text-gray-400 block mb-1">ROI</span>
                          <span className={`font-bold text-lg ${result.roi >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {formatCurrency(result.roi, { decimals: 2, prefix: '', suffix: '%' })}
                          </span>
                        </div>
                        <div className="text-center p-2 bg-gray-800/30 rounded-lg">
                          <span className="text-gray-400 block mb-1">Fees</span>
                          <span className="text-orange-400 font-bold">{formatCurrency(result.fees)}</span>
                        </div>
                        <div className="text-center p-2 bg-gray-800/30 rounded-lg">
                          <span className="text-gray-400 block mb-1">Final Amount</span>
                          <span className="text-cyan-400 font-bold">{formatCurrency(result.finalAmount)}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer with Disclaimers */}
      <footer className="mt-12 py-8 border-t border-gray-700/50">
        <div className="container mx-auto px-4 max-w-4xl">
          <div className="text-center space-y-4">
            {/* Main Disclaimer */}
            <div className="bg-gray-900/50 rounded-lg p-6 border border-gray-700/30">
              <h3 className="text-md font-semibold text-yellow-400 mb-3 flex items-center justify-center gap-2">
                ⚠️ Important Disclaimer
              </h3>
              <div className="text-sm text-gray-300 space-y-2 leading-relaxed">
                <p>
                  <strong className="text-gray-200">Not Financial Advice:</strong> This calculator is for educational and informational purposes only. 
                  It does not constitute financial, investment, or trading advice. Always consult with qualified financial professionals 
                  before making investment decisions.
                </p>
                <p>
                  <strong className="text-gray-200">Trading Risks:</strong> Cryptocurrency trading involves substantial risk and may result in significant losses. 
                  Leverage trading amplifies both potential profits and losses. Never trade with funds you cannot afford to lose.
                </p>
                <p>
                  <strong className="text-gray-200">No Affiliation:</strong> This tool is not affiliated with, endorsed by, or connected to Bybit, 
                  any cryptocurrency exchanges, or blockchain projects. All trademarks belong to their respective owners.
                </p>
              </div>
            </div>

            {/* Additional Legal Info */}
            <div className="text-xs text-gray-500 space-y-2">
              <p>
                Calculations are estimates based on current market data and may not reflect actual trading results. 
                Market conditions, fees, and slippage may affect actual outcomes.
              </p>
              <p>
                © 2025 Bybit Leverage Calculator • Open Source (MIT License) • 
                <a 
                  href="https://github.com/marcosfreitas/bybit-leverage-calculator" 
                  className="text-cyan-400 hover:text-cyan-300 ml-1"
                  target="_blank" 
                  rel="noopener noreferrer"
                >
                  View Source Code
                </a>
              </p>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default BybitLeverageCalculator;