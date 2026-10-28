#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

// Kept free of Python headers so Swift can import it without the CPython module map.
@interface TidePython : NSObject

+ (nullable NSString *)pythonVersionAndReturnError:(NSError **)error;
+ (nullable NSString *)runCode:(NSString *)code error:(NSError **)error;

@end

NS_ASSUME_NONNULL_END
